-- PC08: reviewed household membership and confirmed household facts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.crm_household_commands') IS NOT NULL OR
     to_regprocedure('public.crm_household_preview_v1(text,uuid,bigint,text,jsonb)') IS NOT NULL OR
     to_regprocedure('public.crm_household_execute_v1(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'PC08 household lifecycle objects already exist; inspect before migrating';
  END IF;
END $guard$;

ALTER TABLE public.households
  ADD COLUMN important_facts_confirmed_at timestamptz,
  ADD COLUMN important_facts_confirmed_by_uid text;

CREATE TABLE public.crm_household_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  household_id bigint REFERENCES public.households(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('add_member','update_member','remove_member','save_facts')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  before_state jsonb NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  UNIQUE (actor_uid, idempotency_key)
);
CREATE INDEX crm_household_commands_actor_idx
  ON public.crm_household_commands(actor_uid, created_at DESC);
CREATE INDEX crm_household_commands_person_idx
  ON public.crm_household_commands(person_id, created_at DESC);
ALTER TABLE public.crm_household_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_household_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_household_commands_service_only ON public.crm_household_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_household_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_household_commands TO service_role;
GRANT UPDATE (relationship_to_anchor, confirmed_at, confirmed_by_uid, updated_at, deleted_at)
  ON public.household_members TO service_role;
GRANT UPDATE (important_facts, important_facts_confirmed_at,
  important_facts_confirmed_by_uid, updated_at) ON public.households TO service_role;

CREATE FUNCTION public.crm_household_preview_v1(
  p_actor_uid text, p_idempotency_key uuid, p_person_id bigint,
  p_operation text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $preview$
DECLARE
  v_person public.persons%ROWTYPE;
  v_member_person public.persons%ROWTYPE;
  v_household public.households%ROWTYPE;
  v_member public.household_members%ROWTYPE;
  v_previous public.crm_household_commands%ROWTYPE;
  v_command public.crm_household_commands%ROWTYPE;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_household_id bigint;
  v_member_id bigint;
  v_person_id bigint;
  v_member_name text;
  v_relationship text;
  v_facts text;
  v_batch text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_person_id IS NULL OR p_person_id < 1 OR p_operation IS NULL OR
     p_operation NOT IN ('add_member','update_member','remove_member','save_facts') OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text) > 8000 THEN
    RAISE EXCEPTION 'Invalid household command' USING ERRCODE='22023';
  END IF;
  IF (p_operation='add_member' AND
      (EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('householdId','memberId','memberName','relationship')) OR
       NOT (p_payload ? 'memberId' AND p_payload ? 'memberName' AND p_payload ? 'relationship'))) OR
     (p_operation IN ('update_member','remove_member') AND
      (EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('householdId','membershipId','relationship')) OR
       NOT (p_payload ? 'householdId' AND p_payload ? 'membershipId') OR
       (p_operation='update_member' AND NOT (p_payload ? 'relationship')))) OR
     (p_operation='save_facts' AND
      (EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('householdId','facts')) OR
       NOT (p_payload ? 'householdId' AND p_payload ? 'facts') OR
       jsonb_typeof(p_payload->'facts') IS DISTINCT FROM 'string' OR
       length(p_payload->>'facts') > 2000)) THEN
    RAISE EXCEPTION 'Invalid household command payload' USING ERRCODE='22023';
  END IF;
  IF p_operation IN ('add_member','update_member') AND
     (jsonb_typeof(p_payload->'relationship') IS DISTINCT FROM 'string' OR
      p_payload->>'relationship' NOT IN ('spouse','child','parent','sibling','other')) THEN
    RAISE EXCEPTION 'Invalid household relationship' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_previous FROM public.crm_household_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.person_id<>p_person_id OR v_previous.operation<>p_operation OR
       v_previous.payload<>p_payload THEN
      RAISE EXCEPTION 'Household idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_previous.id,'preview',v_previous.preview,
      'expiresAt',v_previous.expires_at,'status',v_previous.status,
      'result',v_previous.result,'replayed',true,'businessDataWritten',false);
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Person not found or deleted' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN coalesce(v_person.display_name,''))=0 OR
      NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b USING(batch_key)
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=p_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
  END IF;

  IF p_operation='add_member' THEN
    v_person_id := (p_payload->>'memberId')::bigint;
    v_member_name := btrim(p_payload->>'memberName');
    v_relationship := p_payload->>'relationship';
    IF v_person_id IS NULL OR v_person_id<1 OR length(v_member_name) NOT BETWEEN 1 AND 120 OR
       v_person_id=p_person_id THEN RAISE EXCEPTION 'Invalid household Person selection' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_member_person FROM public.persons WHERE id=v_person_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_member_person.display_name IS DISTINCT FROM v_member_name THEN
      RAISE EXCEPTION 'Selected Person changed; resolve identity again' USING ERRCODE='40001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
       (position('【系统测试·勿联系】' IN coalesce(v_member_person.display_name,''))=0 OR
        NOT EXISTS (SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b USING(batch_key)
          WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=v_person_id::text
            AND r.batch_key IN (SELECT batch_key FROM public.crm_test_records WHERE record_table='persons'
              AND record_id=p_person_id::text))) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
    END IF;
    v_household_id := nullif(p_payload->>'householdId','')::bigint;
    IF v_household_id IS NULL THEN
      SELECT * INTO v_household FROM public.households
        WHERE anchor_person_id=p_person_id AND deleted_at IS NULL;
      IF FOUND THEN v_household_id:=v_household.id; END IF;
    ELSE
      SELECT * INTO v_household FROM public.households
        WHERE id=v_household_id AND anchor_person_id=p_person_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Only the Person anchored household accepts a new member' USING ERRCODE='42501'; END IF;
    END IF;
    IF v_household.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.household_members
      WHERE household_id=v_household.id AND person_id=v_person_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Person is already a member of this household' USING ERRCODE='23505';
    END IF;
    v_before := jsonb_build_object('householdId',v_household.id,'householdUpdatedAt',v_household.updated_at);
    v_after := jsonb_build_object('householdId',v_household.id,'anchorPersonId',p_person_id,
      'memberId',v_person_id,'memberName',v_member_name,'relationship',v_relationship,'confirmed',true);
  ELSIF p_operation IN ('update_member','remove_member') THEN
    v_household_id := (p_payload->>'householdId')::bigint;
    v_member_id := (p_payload->>'membershipId')::bigint;
    IF v_household_id<1 OR v_member_id<1 THEN RAISE EXCEPTION 'Invalid household membership' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_household FROM public.households WHERE id=v_household_id AND deleted_at IS NULL;
    IF NOT FOUND OR (v_household.anchor_person_id<>p_person_id AND NOT EXISTS (
       SELECT 1 FROM public.household_members WHERE household_id=v_household_id AND person_id=p_person_id
         AND deleted_at IS NULL AND confirmed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Household is not linked to this Person' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_member FROM public.household_members
      WHERE id=v_member_id AND household_id=v_household_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Household member not found' USING ERRCODE='40001'; END IF;
    SELECT * INTO v_member_person FROM public.persons WHERE id=v_member.person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Household member Person is unavailable' USING ERRCODE='40001'; END IF;
    v_before := jsonb_build_object('householdId',v_household.id,'anchorPersonId',v_household.anchor_person_id,
      'householdUpdatedAt',v_household.updated_at,'membershipId',v_member.id,'personId',v_member.person_id,
      'personName',v_member_person.display_name,'relationship',v_member.relationship_to_anchor,
      'confirmedAt',v_member.confirmed_at,'confirmedByUid',v_member.confirmed_by_uid,
      'updatedAt',v_member.updated_at,'deletedAt',v_member.deleted_at);
    v_after := CASE WHEN p_operation='remove_member' THEN jsonb_build_object(
      'householdId',v_household.id,'membershipId',v_member.id,'personId',v_member.person_id,
      'personName',v_member_person.display_name,'deleted',true,'personDeleted',false)
      ELSE jsonb_build_object('householdId',v_household.id,'membershipId',v_member.id,
        'personId',v_member.person_id,'personName',v_member_person.display_name,
        'relationship',p_payload->>'relationship','confirmed',true) END;
  ELSE
    v_household_id := (p_payload->>'householdId')::bigint;
    v_facts := btrim(p_payload->>'facts');
    SELECT * INTO v_household FROM public.households WHERE id=v_household_id AND deleted_at IS NULL;
    IF NOT FOUND OR (v_household.anchor_person_id<>p_person_id AND NOT EXISTS (
       SELECT 1 FROM public.household_members WHERE household_id=v_household_id AND person_id=p_person_id
         AND deleted_at IS NULL AND confirmed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Household is not linked to this Person' USING ERRCODE='42501';
    END IF;
    IF v_household.anchor_person_id<>p_person_id THEN
      RAISE EXCEPTION 'Only the household anchor can confirm household facts' USING ERRCODE='42501';
    END IF;
    v_before := jsonb_build_object('householdId',v_household.id,'anchorPersonId',v_household.anchor_person_id,
      'updatedAt',v_household.updated_at,'facts',v_household.important_facts,
      'confirmedAt',v_household.important_facts_confirmed_at,
      'confirmedByUid',v_household.important_facts_confirmed_by_uid);
    v_after := jsonb_build_object('householdId',v_household.id,'facts',nullif(v_facts,''),
      'confirmed',length(v_facts)>0,'confirmedByUid',CASE WHEN length(v_facts)>0 THEN p_actor_uid ELSE NULL END);
  END IF;
  INSERT INTO public.crm_household_commands(actor_uid,idempotency_key,person_id,household_id,
      operation,payload,before_state,preview)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,v_household_id,p_operation,p_payload,v_before,
      jsonb_build_object('personId',p_person_id,'personName',v_person.display_name,
        'operation',p_operation,'before',v_before,'after',v_after))
    ON CONFLICT(actor_uid,idempotency_key) DO NOTHING RETURNING * INTO v_command;
  IF NOT FOUND THEN
    SELECT * INTO v_command FROM public.crm_household_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_command.person_id<>p_person_id OR v_command.operation<>p_operation OR v_command.payload<>p_payload THEN
      RAISE EXCEPTION 'Household idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
      'expiresAt',v_command.expires_at,'status',v_command.status,'result',v_command.result,
      'replayed',true,'businessDataWritten',false);
  END IF;
  RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
    'expiresAt',v_command.expires_at,'status','preview','businessDataWritten',false);
END $preview$;

CREATE FUNCTION public.crm_household_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $execute$
DECLARE
  v_command public.crm_household_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_member_person public.persons%ROWTYPE;
  v_household public.households%ROWTYPE;
  v_member public.household_members%ROWTYPE;
  v_household_id bigint;
  v_member_id bigint;
  v_new_member_id bigint;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_batch text;
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid household execution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_command FROM public.crm_household_commands WHERE id=p_preview_id FOR UPDATE;
  IF NOT FOUND OR v_command.actor_uid<>p_actor_uid THEN RAISE EXCEPTION 'Household preview not found' USING ERRCODE='42501'; END IF;
  IF v_command.status='executed' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'result',v_command.result);
  END IF;
  IF v_command.expires_at<v_now THEN RAISE EXCEPTION 'Household preview expired' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=v_command.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.display_name IS DISTINCT FROM v_command.preview->>'personName' THEN
    RAISE EXCEPTION 'Person changed; preview again' USING ERRCODE='40001';
  END IF;
  IF v_command.operation='add_member' THEN
    v_member_id:=(v_command.payload->>'memberId')::bigint;
    SELECT * INTO v_member_person FROM public.persons WHERE id=v_member_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_member_person.display_name IS DISTINCT FROM v_command.payload->>'memberName' OR v_member_id=v_person.id THEN
      RAISE EXCEPTION 'Selected Person changed; resolve identity again' USING ERRCODE='40001';
    END IF;
    v_household_id:=nullif(v_command.before_state->>'householdId','')::bigint;
    IF v_household_id IS NULL THEN
      SELECT * INTO v_household FROM public.households WHERE anchor_person_id=v_person.id AND deleted_at IS NULL FOR UPDATE;
      IF FOUND THEN
        RAISE EXCEPTION 'Household changed; preview again' USING ERRCODE='40001';
      ELSE
        INSERT INTO public.households(anchor_person_id) VALUES(v_person.id) RETURNING * INTO v_household;
      END IF;
    ELSE
      SELECT * INTO v_household FROM public.households
        WHERE id=v_household_id AND anchor_person_id=v_person.id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND OR v_household.updated_at IS DISTINCT FROM (v_command.before_state->>'householdUpdatedAt')::timestamptz THEN
        RAISE EXCEPTION 'Household changed; preview again' USING ERRCODE='40001';
      END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM public.household_members WHERE household_id=v_household.id AND person_id=v_member_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Person is already a member; preview again' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.household_members(household_id,person_id,relationship_to_anchor,confirmed_at,confirmed_by_uid)
      VALUES(v_household.id,v_member_id,v_command.payload->>'relationship',v_now,p_actor_uid)
      RETURNING id INTO v_new_member_id;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) THEN
      SELECT r.batch_key INTO v_batch FROM public.crm_test_records r
        JOIN public.crm_test_batches b USING(batch_key)
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=v_person.id::text
        ORDER BY r.created_at LIMIT 1;
      IF v_batch IS NULL OR NOT EXISTS(SELECT 1 FROM public.crm_test_records
        WHERE batch_key=v_batch AND record_table='persons' AND record_id=v_member_id::text) THEN
        RAISE EXCEPTION 'Test household Persons must belong to one tracked batch' USING ERRCODE='42501';
      END IF;
      INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
        VALUES(v_batch,'households',v_household.id::text,'derived','persons',v_person.id::text,'【系统测试·勿联系】PC08 家庭')
        ON CONFLICT DO NOTHING;
      INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
        VALUES(v_batch,'household_members',v_new_member_id::text,'derived','households',v_household.id::text,'【系统测试·勿联系】PC08 家庭成员')
        ON CONFLICT DO NOTHING;
    END IF;
    v_household_id:=v_household.id;
    v_result:=jsonb_build_object('householdId',v_household_id,'membershipId',v_new_member_id,'personId',v_member_id);
  ELSIF v_command.operation IN ('update_member','remove_member') THEN
    v_household_id:=(v_command.payload->>'householdId')::bigint;
    v_member_id:=(v_command.payload->>'membershipId')::bigint;
    SELECT * INTO v_household FROM public.households WHERE id=v_household_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR (v_household.anchor_person_id<>v_person.id AND NOT EXISTS(
      SELECT 1 FROM public.household_members WHERE household_id=v_household_id AND person_id=v_person.id
       AND deleted_at IS NULL AND confirmed_at IS NOT NULL)) THEN RAISE EXCEPTION 'Household link changed; preview again' USING ERRCODE='40001'; END IF;
    SELECT * INTO v_member FROM public.household_members WHERE id=v_member_id AND household_id=v_household_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_member.person_id IS DISTINCT FROM (v_command.before_state->>'personId')::bigint OR
       v_member.relationship_to_anchor IS DISTINCT FROM v_command.before_state->>'relationship' OR
       v_member.confirmed_at IS DISTINCT FROM (v_command.before_state->>'confirmedAt')::timestamptz OR
       v_member.confirmed_by_uid IS DISTINCT FROM v_command.before_state->>'confirmedByUid' OR
       v_member.updated_at IS DISTINCT FROM (v_command.before_state->>'updatedAt')::timestamptz THEN
      RAISE EXCEPTION 'Household member changed; preview again' USING ERRCODE='40001';
    END IF;
    SELECT * INTO v_member_person FROM public.persons WHERE id=v_member.person_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_member_person.display_name IS DISTINCT FROM v_command.before_state->>'personName' THEN
      RAISE EXCEPTION 'Household member identity changed; preview again' USING ERRCODE='40001';
    END IF;
    IF v_command.operation='remove_member' THEN
      UPDATE public.household_members SET deleted_at=v_now,updated_at=v_now
        WHERE id=v_member.id RETURNING id INTO v_member_id;
      v_result:=jsonb_build_object('householdId',v_household_id,'membershipId',v_member_id,'removed',true,'personDeleted',false);
    ELSE
      UPDATE public.household_members SET relationship_to_anchor=v_command.payload->>'relationship',
        confirmed_at=v_now,confirmed_by_uid=p_actor_uid,updated_at=v_now
        WHERE id=v_member.id RETURNING id INTO v_member_id;
      v_result:=jsonb_build_object('householdId',v_household_id,'membershipId',v_member_id,
        'updated',true,'relationship',v_command.payload->>'relationship');
    END IF;
  ELSE
    v_household_id:=(v_command.payload->>'householdId')::bigint;
    SELECT * INTO v_household FROM public.households WHERE id=v_household_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_household.anchor_person_id<>v_person.id OR
       v_household.updated_at IS DISTINCT FROM (v_command.before_state->>'updatedAt')::timestamptz OR
       v_household.important_facts IS DISTINCT FROM v_command.before_state->>'facts' OR
       v_household.important_facts_confirmed_at IS DISTINCT FROM (v_command.before_state->>'confirmedAt')::timestamptz OR
       v_household.important_facts_confirmed_by_uid IS DISTINCT FROM v_command.before_state->>'confirmedByUid' THEN
      RAISE EXCEPTION 'Household facts changed; preview again' USING ERRCODE='40001';
    END IF;
    UPDATE public.households SET important_facts=nullif(btrim(v_command.payload->>'facts'),''),
      important_facts_confirmed_at=CASE WHEN length(btrim(v_command.payload->>'facts'))>0 THEN v_now ELSE NULL END,
      important_facts_confirmed_by_uid=CASE WHEN length(btrim(v_command.payload->>'facts'))>0 THEN p_actor_uid ELSE NULL END,
      updated_at=v_now WHERE id=v_household.id;
    v_result:=jsonb_build_object('householdId',v_household_id,'saved',true,
      'confirmed',length(btrim(v_command.payload->>'facts'))>0);
  END IF;
  UPDATE public.crm_household_commands SET status='executed',executed_at=v_now,result=v_result,
    household_id=coalesce(v_household_id,household_id) WHERE id=v_command.id;
  RETURN jsonb_build_object('ok',true,'result',v_result);
END $execute$;

REVOKE ALL ON FUNCTION public.crm_household_preview_v1(text,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_household_execute_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_household_preview_v1(text,uuid,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_household_execute_v1(text,uuid) TO service_role;
COMMIT;
