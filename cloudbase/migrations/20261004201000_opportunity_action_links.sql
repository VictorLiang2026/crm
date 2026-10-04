-- WP10 follow-up: preserve immutable Action links; record human-confirmed association separately.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.crm_opportunity_action_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  action_id bigint NOT NULL UNIQUE REFERENCES public.actions(id) ON DELETE RESTRICT,
  created_by_uid text NOT NULL CHECK (length(btrim(created_by_uid)) BETWEEN 1 AND 128),
  command_id uuid NOT NULL UNIQUE REFERENCES public.crm_opportunity_commands(id) ON DELETE RESTRICT,
  batch_key text REFERENCES public.crm_test_batches(batch_key) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_opportunity_action_links_person_opp_idx
  ON public.crm_opportunity_action_links(person_id,opportunity_id,created_at DESC);
ALTER TABLE public.crm_opportunity_action_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunity_action_links FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_opportunity_action_links_service_only ON public.crm_opportunity_action_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_opportunity_action_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.crm_opportunity_action_links TO service_role;

CREATE OR REPLACE FUNCTION public.crm_opportunity_preview_v1(
  p_actor_uid text, p_idempotency_key uuid, p_operation text,
  p_person_id bigint, p_opportunity_id bigint, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $preview$
DECLARE
  v_person public.persons%ROWTYPE;
  v_opp public.opportunities%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_cmd public.crm_opportunity_commands%ROWTYPE;
  v_type text;
  v_action_id bigint;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_operation IS NULL OR p_operation NOT IN ('create','edit','stage','close','link_action') OR
     p_person_id IS NULL OR p_person_id < 1 OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text)>12000 OR
     (p_operation='create' AND p_opportunity_id IS NOT NULL) OR
     (p_operation<>'create' AND (p_opportunity_id IS NULL OR p_opportunity_id<1)) THEN
    RAISE EXCEPTION 'Invalid Opportunity command' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cmd FROM public.crm_opportunity_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_cmd.operation<>p_operation OR v_cmd.person_id<>p_person_id OR
       v_cmd.opportunity_id IS DISTINCT FROM p_opportunity_id OR v_cmd.payload<>p_payload THEN
      RAISE EXCEPTION 'Opportunity idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_cmd.id,'preview',v_cmd.preview,
      'expiresAt',v_cmd.expires_at,'status',v_cmd.status,'result',v_cmd.result,'replayed',true);
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN v_person.display_name)=0 OR NOT EXISTS (
       SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
         ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
         AND r.record_table='persons' AND r.record_id=p_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
  END IF;
  IF p_operation<>'create' THEN
    SELECT * INTO v_opp FROM public.opportunities
      WHERE id=p_opportunity_id AND person_id=p_person_id
        AND customer_id IS NULL AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person-only Opportunity unavailable' USING ERRCODE='42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
         ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
         AND r.record_table='opportunities' AND r.record_id=v_opp.id::text) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional Opportunity' USING ERRCODE='42501';
    END IF;
    v_before:=jsonb_build_object('id',v_opp.id,'type',v_opp.opportunity_type,
      'status',v_opp.status,'progress',v_opp.last_progress,
      'nextAction',v_opp.next_action,'nextActionDate',v_opp.next_action_date);
  END IF;
  IF p_operation IN ('create','edit') THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>4 OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k
         WHERE k NOT IN ('type','progress','nextAction','nextActionDate')) OR
       jsonb_typeof(p_payload->'type') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'progress') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'nextAction') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'nextActionDate') NOT IN ('string','null') OR
       length(p_payload->>'progress')>4000 OR
       length(p_payload->>'nextAction')>1000 THEN
      RAISE EXCEPTION 'Invalid Opportunity draft' USING ERRCODE='22023';
    END IF;
    v_type:=p_payload->>'type';
    IF v_type NOT IN ('insurance','recruit','referral','activity','speaker',
        'partnership','service','relationship') THEN
      RAISE EXCEPTION 'Invalid Opportunity type' USING ERRCODE='22023'; END IF;
    IF p_payload->>'nextActionDate' IS NOT NULL THEN
      IF p_payload->>'nextActionDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid Opportunity date' USING ERRCODE='22023'; END IF;
      PERFORM (p_payload->>'nextActionDate')::date;
    END IF;
    IF p_operation='edit' AND v_opp.status IN ('成交','关闭') THEN
      RAISE EXCEPTION 'Closed Opportunity cannot be edited' USING ERRCODE='40001'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       (position('【系统测试·勿联系】' IN coalesce(p_payload->>'progress',''))=0 OR
        position('【系统测试·勿联系】' IN coalesce(p_payload->>'nextAction',''))=0) THEN
      RAISE EXCEPTION 'Test Opportunity text must be marked' USING ERRCODE='42501'; END IF;
    v_after:=p_payload;
  ELSIF p_operation='stage' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR
       jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' OR
       p_payload->>'status' NOT IN (CASE WHEN v_opp.opportunity_type='referral'
         THEN '潜在线索' ELSE '发现' END,'沟通','方案','已介绍','已联系','已建立关系') OR
       v_opp.status IN ('成交','关闭') THEN
      RAISE EXCEPTION 'Invalid Opportunity stage' USING ERRCODE='22023'; END IF;
    IF (v_opp.opportunity_type='referral' AND p_payload->>'status' NOT IN
        ('潜在线索','已介绍','已联系','已建立关系')) OR
       (v_opp.opportunity_type<>'referral' AND p_payload->>'status' NOT IN
        ('发现','沟通','方案')) THEN
      RAISE EXCEPTION 'Stage does not match Opportunity type' USING ERRCODE='22023'; END IF;
    v_after:=p_payload;
  ELSIF p_operation='close' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3 OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k
         WHERE k NOT IN ('status','result','actionId')) OR
       NOT (p_payload ? 'status' AND p_payload ? 'result' AND p_payload ? 'actionId') OR
       jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' OR
       p_payload->>'status' NOT IN ('成交','关闭') OR
       jsonb_typeof(p_payload->'result') IS DISTINCT FROM 'string' OR
       length(btrim(p_payload->>'result')) NOT BETWEEN 1 AND 4000 OR
       jsonb_typeof(p_payload->'actionId') IS NULL OR
       jsonb_typeof(p_payload->'actionId') NOT IN ('number','null') OR
       v_opp.status IN ('成交','关闭') THEN
      RAISE EXCEPTION 'Invalid Opportunity closing result' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       position('【系统测试·勿联系】' IN p_payload->>'result')=0 THEN
      RAISE EXCEPTION 'Test Outcome text must be marked' USING ERRCODE='42501'; END IF;
    v_after:=p_payload;
  ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR
       jsonb_typeof(p_payload->'actionId') IS DISTINCT FROM 'number' OR
       v_opp.status IN ('成交','关闭') THEN
      RAISE EXCEPTION 'Invalid Action link' USING ERRCODE='22023'; END IF;
    v_after:=p_payload;
  END IF;
  IF p_operation IN ('close','link_action') AND p_payload->>'actionId' IS NOT NULL THEN
    IF p_payload->>'actionId' !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Invalid Action ID' USING ERRCODE='22023'; END IF;
    v_action_id:=(p_payload->>'actionId')::bigint;
    SELECT * INTO v_action FROM public.actions WHERE id=v_action_id AND person_id=p_person_id;
    IF NOT FOUND OR (p_operation='close' AND v_action.opportunity_id IS DISTINCT FROM v_opp.id
      AND NOT EXISTS (SELECT 1 FROM public.crm_opportunity_action_links l
        WHERE l.person_id=p_person_id AND l.opportunity_id=v_opp.id AND l.action_id=v_action.id)) OR
       (p_operation='link_action' AND (v_action.opportunity_id IS NOT NULL OR EXISTS
        (SELECT 1 FROM public.crm_opportunity_action_links l WHERE l.action_id=v_action.id))) THEN
      RAISE EXCEPTION 'Action is not available for this Opportunity' USING ERRCODE='42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
         ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
         AND r.record_table='actions' AND r.record_id=v_action.id::text) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional Action' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.crm_opportunity_commands(actor_uid,idempotency_key,operation,person_id,
    opportunity_id,payload,preview,person_updated_at,opportunity_updated_at,
    action_id,action_updated_at)
  VALUES(p_actor_uid,p_idempotency_key,p_operation,p_person_id,p_opportunity_id,
    p_payload,jsonb_build_object('operation',p_operation,'personId',p_person_id,
      'personName',v_person.display_name,'opportunityId',p_opportunity_id,
      'before',v_before,'after',v_after,'source',CASE WHEN p_operation='create'
        THEN 'manual' ELSE 'public.opportunities#'||p_opportunity_id::text END),
    v_person.updated_at,CASE WHEN p_operation='create' THEN NULL ELSE v_opp.updated_at END,
    v_action_id,CASE WHEN v_action_id IS NULL THEN NULL ELSE v_action.updated_at END)
  ON CONFLICT(actor_uid,idempotency_key) DO NOTHING RETURNING * INTO v_cmd;
  IF NOT FOUND THEN
    SELECT * INTO v_cmd FROM public.crm_opportunity_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_cmd.operation<>p_operation OR v_cmd.person_id<>p_person_id OR
       v_cmd.opportunity_id IS DISTINCT FROM p_opportunity_id OR v_cmd.payload<>p_payload THEN
      RAISE EXCEPTION 'Opportunity idempotency key reused' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN jsonb_build_object('previewId',v_cmd.id,'preview',v_cmd.preview,
    'expiresAt',v_cmd.expires_at,'status',v_cmd.status,'businessDataWritten',false);
END $preview$;

CREATE OR REPLACE FUNCTION public.crm_opportunity_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $execute$
DECLARE
  v_cmd public.crm_opportunity_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_opp public.opportunities%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_id bigint;
  v_outcome_id bigint;
  v_link_id uuid;
  v_batch_key text;
  v_result jsonb;
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Opportunity execution' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_cmd FROM public.crm_opportunity_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity preview not found for account' USING ERRCODE='42501'; END IF;
  IF v_cmd.status='executed' THEN RETURN v_cmd.result||jsonb_build_object('replayed',true); END IF;
  IF v_cmd.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Opportunity preview expired' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_cmd.person_updated_at THEN
    RAISE EXCEPTION 'Person changed; preview again' USING ERRCODE='40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN v_person.display_name)=0 OR NOT EXISTS (
       SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
         ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
         AND r.record_table='persons' AND r.record_id=v_person.id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501'; END IF;
  IF v_cmd.operation='create' THEN
    INSERT INTO public.opportunities(person_id,customer_id,opportunity_type,status,
      discovered_at,last_progress,next_action,next_action_date)
    VALUES(v_cmd.person_id,NULL,v_cmd.payload->>'type',
      CASE WHEN v_cmd.payload->>'type'='referral' THEN '潜在线索' ELSE '发现' END,
      (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date,
      v_cmd.payload->>'progress',v_cmd.payload->>'nextAction',
      (v_cmd.payload->>'nextActionDate')::date) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_opp FROM public.opportunities
      WHERE id=v_cmd.opportunity_id AND person_id=v_cmd.person_id
        AND customer_id IS NULL AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_opp.updated_at IS DISTINCT FROM v_cmd.opportunity_updated_at THEN
      RAISE EXCEPTION 'Opportunity changed; preview again' USING ERRCODE='40001'; END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
         ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
         AND r.record_table='opportunities' AND r.record_id=v_opp.id::text) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional Opportunity' USING ERRCODE='42501'; END IF;
    v_id:=v_opp.id;
    IF v_cmd.operation='edit' THEN
      IF v_opp.status IN ('成交','关闭') THEN
        RAISE EXCEPTION 'Opportunity already closed' USING ERRCODE='40001'; END IF;
      UPDATE public.opportunities SET opportunity_type=v_cmd.payload->>'type',
        last_progress=v_cmd.payload->>'progress',next_action=v_cmd.payload->>'nextAction',
        next_action_date=(v_cmd.payload->>'nextActionDate')::date,updated_at=clock_timestamp()
        WHERE id=v_id;
    ELSIF v_cmd.operation='stage' THEN
      IF v_opp.status IN ('成交','关闭') THEN
        RAISE EXCEPTION 'Opportunity already closed' USING ERRCODE='40001'; END IF;
      UPDATE public.opportunities SET status=v_cmd.payload->>'status',
        updated_at=clock_timestamp() WHERE id=v_id;
    ELSIF v_cmd.operation='close' THEN
      IF v_opp.status IN ('成交','关闭') THEN
        RAISE EXCEPTION 'Opportunity already closed' USING ERRCODE='40001'; END IF;
      IF v_cmd.action_id IS NOT NULL THEN
        SELECT * INTO v_action FROM public.actions WHERE id=v_cmd.action_id
          AND person_id=v_cmd.person_id FOR UPDATE;
        IF NOT FOUND OR v_action.updated_at IS DISTINCT FROM v_cmd.action_updated_at OR
           v_action.opportunity_id IS DISTINCT FROM v_id AND NOT EXISTS
           (SELECT 1 FROM public.crm_opportunity_action_links l
             WHERE l.person_id=v_cmd.person_id AND l.opportunity_id=v_id
               AND l.action_id=v_action.id) THEN
          RAISE EXCEPTION 'Action changed; preview again' USING ERRCODE='40001'; END IF;
      END IF;
      UPDATE public.opportunities SET status=v_cmd.payload->>'status',
        updated_at=clock_timestamp() WHERE id=v_id;
      INSERT INTO public.outcomes(opportunity_id,action_id,outcome_type,result,occurred_at)
        VALUES(v_id,v_cmd.action_id,CASE WHEN v_cmd.payload->>'status'='成交'
          THEN 'opportunity_sale' ELSE 'opportunity_closed' END,
          btrim(v_cmd.payload->>'result'),clock_timestamp()) RETURNING id INTO v_outcome_id;
    ELSE
      SELECT * INTO v_action FROM public.actions WHERE id=v_cmd.action_id
        AND person_id=v_cmd.person_id FOR UPDATE;
      IF NOT FOUND OR v_action.updated_at IS DISTINCT FROM v_cmd.action_updated_at OR
         v_action.opportunity_id IS NOT NULL OR v_opp.status IN ('成交','关闭') OR EXISTS
         (SELECT 1 FROM public.crm_opportunity_action_links l WHERE l.action_id=v_action.id) THEN
        RAISE EXCEPTION 'Action changed; preview again' USING ERRCODE='40001'; END IF;
      IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
         NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b
           ON b.batch_key=r.batch_key WHERE b.created_by_uid=p_actor_uid
           AND r.record_table='actions' AND r.record_id=v_action.id::text) THEN
        RAISE EXCEPTION 'Test account requires tracked fictional Action' USING ERRCODE='42501'; END IF;
      SELECT b.batch_key INTO v_batch_key FROM public.crm_test_batches b
        JOIN public.crm_test_records r ON r.batch_key=b.batch_key
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons'
          AND r.record_id=v_cmd.person_id::text LIMIT 1;
      INSERT INTO public.crm_opportunity_action_links(person_id,opportunity_id,action_id,
        created_by_uid,command_id,batch_key)
        VALUES(v_cmd.person_id,v_id,v_action.id,p_actor_uid,v_cmd.id,v_batch_key)
        RETURNING id INTO v_link_id;
    END IF;
  END IF;
  v_result:=jsonb_build_object('opportunityId',v_id,'outcomeId',v_outcome_id,
    'actionId',v_cmd.action_id,'linkId',v_link_id,
    'operation',v_cmd.operation,'replayed',false);
  UPDATE public.crm_opportunity_commands SET status='executed',result=v_result,
    executed_at=clock_timestamp() WHERE id=v_cmd.id;
  RETURN v_result;
END $execute$;

REVOKE ALL ON FUNCTION public.crm_opportunity_preview_v1(text,uuid,text,bigint,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_opportunity_execute_v1(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_opportunity_preview_v1(text,uuid,text,bigint,bigint,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_opportunity_execute_v1(text,uuid) TO service_role;
COMMIT;
