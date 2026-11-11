BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.activity_participant_responses (
  participant_id bigint PRIMARY KEY REFERENCES public.activity_participants(id) ON DELETE CASCADE,
  response text NOT NULL CHECK (response IN ('registered','cancelled','unrecorded')),
  version uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE public.activity_participant_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_participant_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY participant_response_service ON public.activity_participant_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.activity_participant_responses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.activity_participant_responses TO service_role;

CREATE FUNCTION public.crm_event_participation_v1(p_actor_uid text,p_op text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE
  event_id bigint := (p_input->>'activityId')::bigint;
  person_key bigint := (p_input->>'personId')::bigint;
  part_key bigint := (p_input->>'participantId')::bigint;
  page_no integer := coalesce((p_input->>'page')::integer,1);
  r public.activity_participants%ROWTYPE;
  previous uuid;
  new_response text := p_input->>'response';
  new_status text := p_input->>'status';
  result jsonb;
BEGIN
  IF current_user <> 'service_role' OR coalesce(length(btrim(p_actor_uid)),0) NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid participation request'; END IF;

  IF p_op='person' THEN
    IF p_input-ARRAY['personId','page'] <> '{}'::jsonb OR person_key IS NULL OR person_key < 1 OR page_no NOT BETWEEN 1 AND 100000
       THEN RAISE EXCEPTION 'Invalid participation page'; END IF;
    PERFORM 1 FROM public.persons WHERE id=person_key AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person unavailable'; END IF;
    WITH events AS MATERIALIZED (
      SELECT DISTINCT ON (a.id) a.id AS activity_id,a.name,a.activity_date,ap.status,ap.participant_role,
        coalesce(s.response,'unrecorded') AS response,work.id AS action_id,work.title AS action_title,work.status AS action_status
      FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id AND a.deleted_at IS NULL
      LEFT JOIN public.activity_participant_responses s ON s.participant_id=ap.id
      LEFT JOIN public.v_next_context_action work ON work.kind='activity' AND work.target_id=a.id AND work.person_id=person_key
      WHERE ap.canonical_person_id=person_key AND ap.deleted_at IS NULL
      ORDER BY a.id,ap.updated_at DESC NULLS LAST,ap.id DESC
    ), page_rows AS (
      SELECT * FROM events ORDER BY activity_date DESC NULLS LAST,activity_id DESC LIMIT 20 OFFSET (page_no-1)*20
    )
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY activity_date DESC NULLS LAST,activity_id DESC) FROM page_rows e),'[]'::jsonb),
      'total',count(*),'attended',count(*) FILTER(WHERE status='attended'),'hasMore',count(*)>page_no*20) INTO result FROM events;
    RETURN result;
  END IF;

  IF event_id IS NULL OR event_id<1 THEN RAISE EXCEPTION 'Invalid activity'; END IF;
  IF p_op='responses' AND p_input-'activityId'='{}'::jsonb THEN
    SELECT coalesce(jsonb_object_agg(ap.id,jsonb_build_object('response',s.response,'version',s.version)),'{}'::jsonb)
      INTO result FROM public.activity_participant_responses s
      JOIN public.activity_participants ap ON ap.id=s.participant_id AND ap.deleted_at IS NULL
      JOIN public.activities a ON a.id=ap.activity_id AND a.deleted_at IS NULL WHERE a.id=event_id;
    RETURN jsonb_build_object('responses',result);
  END IF;
  IF p_op IS DISTINCT FROM 'save' OR p_input-ARRAY['participantId','activityId','version','updatedAt','expectedStatus','response','status'] <> '{}'::jsonb
    OR NOT (p_input ?& ARRAY['participantId','activityId','version','updatedAt','expectedStatus','response','status'])
    OR part_key IS NULL OR part_key<1 OR coalesce(new_response,'') NOT IN ('registered','cancelled','unrecorded')
    OR coalesce(new_status,'') NOT IN ('invited','attended','absent') THEN RAISE EXCEPTION 'Invalid participation change'; END IF;

  PERFORM 1 FROM public.activities WHERE id=event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Activity unavailable'; END IF;
  SELECT * INTO STRICT r FROM public.activity_participants WHERE id=part_key AND activity_id=event_id AND deleted_at IS NULL FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
    AND NOT EXISTS (SELECT 1 FROM public.crm_test_batches b JOIN public.crm_test_records er ON er.batch_key=b.batch_key
      JOIN public.crm_test_records ar ON ar.batch_key=b.batch_key
      WHERE b.created_by_uid=p_actor_uid AND er.record_table='activities' AND er.record_id=event_id::text
        AND ar.record_table='activity_participants' AND ar.record_id=part_key::text)
    THEN RAISE EXCEPTION 'Test account requires tracked participants'; END IF;
  SELECT version INTO previous FROM public.activity_participant_responses WHERE participant_id=part_key;
  IF previous IS DISTINCT FROM (p_input->>'version')::uuid OR r.updated_at IS DISTINCT FROM (p_input->>'updatedAt')::timestamptz
    OR r.status IS DISTINCT FROM (p_input->>'expectedStatus') THEN RAISE EXCEPTION 'Participation changed'; END IF;
  IF previous IS NOT NULL OR new_response <> 'unrecorded' THEN
    INSERT INTO public.activity_participant_responses(participant_id,response) VALUES(part_key,new_response)
      ON CONFLICT(participant_id) DO UPDATE SET response=excluded.response,version=excluded.version;
  END IF;
  UPDATE public.activity_participants SET status=new_status,updated_at=clock_timestamp() WHERE id=part_key;
  RETURN jsonb_build_object('ok',true);
END
$fn$;
REVOKE ALL ON FUNCTION public.crm_event_participation_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_event_participation_v1(text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
