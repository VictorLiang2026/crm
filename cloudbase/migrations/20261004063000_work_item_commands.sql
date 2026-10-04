-- WP08 manual Action / Commitment preview and atomic, idempotent execution.
-- Existing business tables and the legacy public.v_action_center view are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.crm_work_item_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('action','commitment')),
  operation text NOT NULL CHECK (operation IN ('create','edit','complete','cancel','reopen')),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  item_id bigint,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  preview jsonb NOT NULL,
  person_updated_at timestamptz NOT NULL,
  item_updated_at timestamptz,
  item_status text,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  executed_at timestamptz,
  UNIQUE(actor_uid,idempotency_key),
  CHECK ((operation = 'create' AND item_id IS NULL AND item_updated_at IS NULL)
      OR (operation <> 'create' AND item_id IS NOT NULL AND item_updated_at IS NOT NULL))
);
CREATE INDEX crm_work_item_commands_actor_idx
  ON public.crm_work_item_commands(actor_uid,created_at DESC);
ALTER TABLE public.crm_work_item_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_work_item_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_work_item_commands_service_only ON public.crm_work_item_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_work_item_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_work_item_commands TO service_role;

CREATE FUNCTION public.crm_work_item_preview_v1(
  p_actor_uid text, p_idempotency_key uuid, p_kind text, p_operation text,
  p_person_id bigint, p_item_id bigint, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $preview$
DECLARE
  v_person public.persons%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_commitment public.commitments%ROWTYPE;
  v_cmd public.crm_work_item_commands%ROWTYPE;
  v_previous public.crm_work_item_commands%ROWTYPE;
  v_item_updated_at timestamptz;
  v_item_status text;
  v_before jsonb;
  v_after jsonb;
  v_due text;
  v_title text;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_kind IS NULL OR p_kind NOT IN ('action','commitment') OR
     p_operation IS NULL OR p_operation NOT IN
       ('create','edit','complete','cancel','reopen') OR p_person_id IS NULL OR
     p_person_id < 1 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
     length(p_payload::text) > 12000 THEN
    RAISE EXCEPTION 'Invalid work item command' USING ERRCODE = '22023';
  END IF;
  IF (p_operation='create' AND p_item_id IS NOT NULL) OR
     (p_operation<>'create' AND (p_item_id IS NULL OR p_item_id < 1)) THEN
    RAISE EXCEPTION 'Invalid work item ID' USING ERRCODE = '22023';
  END IF;
  IF p_operation IN ('complete','cancel','reopen') THEN
    IF p_payload <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid work item transition payload' USING ERRCODE = '22023';
    END IF;
  ELSIF p_kind='action' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS key_name
               WHERE key_name NOT IN ('title','description','dueAt','priority')) OR
       NOT (p_payload ? 'title' AND p_payload ? 'description' AND
            p_payload ? 'dueAt' AND p_payload ? 'priority') OR
       jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'description') NOT IN ('string','null') OR
       jsonb_typeof(p_payload->'dueAt') NOT IN ('string','null') OR
       jsonb_typeof(p_payload->'priority') IS DISTINCT FROM 'string' OR
       coalesce(length(btrim(p_payload->>'title')),0) NOT BETWEEN 1 AND 200 OR
       length(coalesce(p_payload->>'description','')) > 4000 OR
       coalesce(p_payload->>'priority','') NOT IN ('low','medium','high','urgent') THEN
      RAISE EXCEPTION 'Invalid Action draft' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS key_name
               WHERE key_name NOT IN ('content','dueAt','commitmentType')) OR
       NOT (p_payload ? 'content' AND p_payload ? 'dueAt' AND
            p_payload ? 'commitmentType') OR
       jsonb_typeof(p_payload->'content') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'dueAt') NOT IN ('string','null') OR
       jsonb_typeof(p_payload->'commitmentType') IS DISTINCT FROM 'string' OR
       coalesce(length(btrim(p_payload->>'content')),0) NOT BETWEEN 1 AND 4000 OR
       coalesce(p_payload->>'commitmentType','') NOT IN ('I_PROMISED','THEY_PROMISED','MUTUAL') THEN
      RAISE EXCEPTION 'Invalid Commitment draft' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_operation IN ('create','edit') THEN
    v_due := p_payload->>'dueAt';
    IF v_due IS NOT NULL AND v_due <> '' THEN
      IF v_due !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
        RAISE EXCEPTION 'Invalid work item due date' USING ERRCODE = '22023';
      END IF;
      PERFORM v_due::timestamptz;
    END IF;
    v_title := CASE WHEN p_kind='action' THEN p_payload->>'title'
                    ELSE p_payload->>'content' END;
  END IF;
  SELECT * INTO v_previous FROM public.crm_work_item_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.kind<>p_kind OR v_previous.operation<>p_operation OR
       v_previous.person_id<>p_person_id OR
       v_previous.item_id IS DISTINCT FROM p_item_id OR
       v_previous.payload<>p_payload THEN
      RAISE EXCEPTION 'Work item idempotency key reused' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_previous.id,'preview',v_previous.preview,
      'expiresAt',v_previous.expires_at,'status',v_previous.status,
      'result',v_previous.result,'replayed',true);
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work item Person unavailable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN v_person.display_name)=0 OR
      NOT EXISTS (SELECT 1 FROM public.crm_test_records AS person_record
        JOIN public.crm_test_batches AS batch ON batch.batch_key=person_record.batch_key
        WHERE batch.created_by_uid=p_actor_uid AND
          person_record.record_table='persons' AND person_record.record_id=p_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE = '42501';
  END IF;
  IF p_operation<>'create' THEN
    IF p_kind='action' THEN
      SELECT * INTO v_action FROM public.actions
        WHERE id=p_item_id AND person_id=p_person_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Action not found for Person' USING ERRCODE='22023'; END IF;
      v_item_updated_at:=v_action.updated_at;
      v_item_status:=v_action.status;
      v_before:=jsonb_build_object('id',v_action.id,'title',v_action.title,
        'description',v_action.description,'dueAt',v_action.due_at,
        'priority',v_action.priority,'status',v_action.status,
        'completedAt',v_action.completed_at,'source',v_action.source);
    ELSE
      SELECT * INTO v_commitment FROM public.commitments
        WHERE id=p_item_id AND person_id=p_person_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Commitment not found for Person' USING ERRCODE='22023'; END IF;
      v_item_updated_at:=v_commitment.updated_at;
      v_item_status:=v_commitment.status;
      v_before:=jsonb_build_object('id',v_commitment.id,'content',v_commitment.content,
        'dueAt',v_commitment.due_at,'commitmentType',v_commitment.commitment_type,
        'status',v_commitment.status,'completedAt',v_commitment.completed_at,
        'source',v_commitment.source);
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
       AND NOT EXISTS (SELECT 1 FROM public.crm_test_records AS item_record
         JOIN public.crm_test_records AS person_record
           ON person_record.batch_key=item_record.batch_key
          AND person_record.record_table='persons'
          AND person_record.record_id=p_person_id::text
         JOIN public.crm_test_batches AS batch ON batch.batch_key=item_record.batch_key
         WHERE batch.created_by_uid=p_actor_uid AND
           item_record.record_table=CASE WHEN p_kind='action' THEN 'actions' ELSE 'commitments' END
           AND item_record.record_id=p_item_id::text) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional work item' USING ERRCODE='42501';
    END IF;
    IF (p_operation IN ('edit','complete','cancel') AND
        v_item_status NOT IN ('open','in_progress')) OR
       (p_operation='reopen' AND v_item_status NOT IN ('completed','cancelled')) THEN
      RAISE EXCEPTION 'Work item state changed; refresh' USING ERRCODE='40001';
    END IF;
  END IF;
  v_after:=CASE WHEN p_operation IN ('create','edit') THEN p_payload
    ELSE jsonb_build_object('status',CASE p_operation WHEN 'complete' THEN 'completed'
      WHEN 'cancel' THEN 'cancelled' ELSE 'open' END) END;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
     AND v_title IS NOT NULL AND position('【系统测试·勿联系】' IN v_title)=0 THEN
    RAISE EXCEPTION 'Test account requires marked fictional work item' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.crm_work_item_commands(actor_uid,idempotency_key,kind,operation,
    person_id,item_id,payload,preview,person_updated_at,item_updated_at,item_status)
  VALUES(p_actor_uid,p_idempotency_key,p_kind,p_operation,p_person_id,p_item_id,
    p_payload,jsonb_build_object('kind',p_kind,'operation',p_operation,
      'personId',p_person_id,'personName',v_person.display_name,'itemId',p_item_id,
      'before',v_before,'after',v_after),v_person.updated_at,v_item_updated_at,v_item_status)
  ON CONFLICT(actor_uid,idempotency_key) DO NOTHING
  RETURNING * INTO v_cmd;
  IF NOT FOUND THEN
    SELECT * INTO v_cmd FROM public.crm_work_item_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_cmd.kind<>p_kind OR v_cmd.operation<>p_operation OR
       v_cmd.person_id<>p_person_id OR v_cmd.item_id IS DISTINCT FROM p_item_id OR
       v_cmd.payload<>p_payload THEN
      RAISE EXCEPTION 'Work item idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_cmd.id,'preview',v_cmd.preview,
      'expiresAt',v_cmd.expires_at,'status',v_cmd.status,
      'result',v_cmd.result,'replayed',true);
  END IF;
  RETURN jsonb_build_object('previewId',v_cmd.id,'preview',v_cmd.preview,
    'expiresAt',v_cmd.expires_at,'status','preview','businessDataWritten',false);
END $preview$;

CREATE FUNCTION public.crm_work_item_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $execute$
DECLARE
  v_cmd public.crm_work_item_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_commitment public.commitments%ROWTYPE;
  v_id bigint;
  v_row jsonb;
  v_result jsonb;
  v_timestamp timestamptz;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid work item execution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cmd FROM public.crm_work_item_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work item preview not found for account' USING ERRCODE='42501'; END IF;
  IF v_cmd.status='executed' THEN RETURN v_cmd.result || jsonb_build_object('replayed',true); END IF;
  IF v_cmd.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Work item preview expired' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_cmd.person_updated_at THEN
    RAISE EXCEPTION 'Work item Person changed; preview again' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN v_person.display_name)=0 OR
      NOT EXISTS (SELECT 1 FROM public.crm_test_records AS person_record
        JOIN public.crm_test_batches AS batch ON batch.batch_key=person_record.batch_key
        WHERE batch.created_by_uid=p_actor_uid AND
          person_record.record_table='persons' AND person_record.record_id=v_person.id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
  END IF;
  v_timestamp:=clock_timestamp();
  IF v_cmd.kind='action' THEN
    IF v_cmd.operation='create' THEN
      INSERT INTO public.actions(person_id,action_type,title,description,due_at,
        priority,status,source,created_by_uid)
      VALUES(v_cmd.person_id,'manual',btrim(v_cmd.payload->>'title'),
        nullif(v_cmd.payload->>'description',''),nullif(v_cmd.payload->>'dueAt','')::timestamptz,
        v_cmd.payload->>'priority','open','manual',p_actor_uid) RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_action FROM public.actions
        WHERE id=v_cmd.item_id AND person_id=v_cmd.person_id FOR UPDATE;
      IF NOT FOUND OR v_action.updated_at IS DISTINCT FROM v_cmd.item_updated_at OR
         v_action.status IS DISTINCT FROM v_cmd.item_status THEN
        RAISE EXCEPTION 'Action changed; preview again' USING ERRCODE='40001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
         AND NOT EXISTS (SELECT 1 FROM public.crm_test_records AS item_record
           JOIN public.crm_test_records AS person_record
             ON person_record.batch_key=item_record.batch_key
            AND person_record.record_table='persons'
            AND person_record.record_id=v_person.id::text
           JOIN public.crm_test_batches AS batch ON batch.batch_key=item_record.batch_key
           WHERE batch.created_by_uid=p_actor_uid AND
             item_record.record_table='actions' AND item_record.record_id=v_action.id::text) THEN
        RAISE EXCEPTION 'Test account requires tracked fictional Action' USING ERRCODE='42501';
      END IF;
      v_id:=v_action.id;
      IF v_cmd.operation='edit' THEN
        IF v_action.status NOT IN ('open','in_progress') THEN
          RAISE EXCEPTION 'Action state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.actions SET title=btrim(v_cmd.payload->>'title'),
          description=nullif(v_cmd.payload->>'description',''),
          due_at=nullif(v_cmd.payload->>'dueAt','')::timestamptz,
          priority=v_cmd.payload->>'priority',updated_at=v_timestamp WHERE id=v_id;
      ELSIF v_cmd.operation='complete' THEN
        IF v_action.status NOT IN ('open','in_progress') THEN
          RAISE EXCEPTION 'Action state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.actions SET status='completed',completed_at=v_timestamp,
          completed_by_uid=p_actor_uid,updated_at=v_timestamp WHERE id=v_id;
      ELSIF v_cmd.operation='cancel' THEN
        IF v_action.status NOT IN ('open','in_progress') THEN
          RAISE EXCEPTION 'Action state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.actions SET status='cancelled',completed_at=NULL,
          completed_by_uid=NULL,updated_at=v_timestamp WHERE id=v_id;
      ELSE
        IF v_action.status NOT IN ('completed','cancelled') THEN
          RAISE EXCEPTION 'Action state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.actions SET status='open',completed_at=NULL,
          completed_by_uid=NULL,updated_at=v_timestamp WHERE id=v_id;
      END IF;
    END IF;
    SELECT to_jsonb(a) INTO v_row FROM public.actions AS a WHERE a.id=v_id;
  ELSE
    IF v_cmd.operation='create' THEN
      INSERT INTO public.commitments(person_id,commitment_type,content,due_at,
        status,source,created_by_uid)
      VALUES(v_cmd.person_id,v_cmd.payload->>'commitmentType',
        btrim(v_cmd.payload->>'content'),nullif(v_cmd.payload->>'dueAt','')::timestamptz,
        'open','manual',p_actor_uid) RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_commitment FROM public.commitments
        WHERE id=v_cmd.item_id AND person_id=v_cmd.person_id FOR UPDATE;
      IF NOT FOUND OR v_commitment.updated_at IS DISTINCT FROM v_cmd.item_updated_at OR
         v_commitment.status IS DISTINCT FROM v_cmd.item_status THEN
        RAISE EXCEPTION 'Commitment changed; preview again' USING ERRCODE='40001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
         AND NOT EXISTS (SELECT 1 FROM public.crm_test_records AS item_record
           JOIN public.crm_test_records AS person_record
             ON person_record.batch_key=item_record.batch_key
            AND person_record.record_table='persons'
            AND person_record.record_id=v_person.id::text
           JOIN public.crm_test_batches AS batch ON batch.batch_key=item_record.batch_key
           WHERE batch.created_by_uid=p_actor_uid AND
             item_record.record_table='commitments' AND item_record.record_id=v_commitment.id::text) THEN
        RAISE EXCEPTION 'Test account requires tracked fictional Commitment' USING ERRCODE='42501';
      END IF;
      v_id:=v_commitment.id;
      IF v_cmd.operation='edit' THEN
        IF v_commitment.status<>'open' THEN
          RAISE EXCEPTION 'Commitment state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.commitments SET content=btrim(v_cmd.payload->>'content'),
          due_at=nullif(v_cmd.payload->>'dueAt','')::timestamptz,
          commitment_type=v_cmd.payload->>'commitmentType',updated_at=v_timestamp WHERE id=v_id;
      ELSIF v_cmd.operation='complete' THEN
        IF v_commitment.status<>'open' THEN
          RAISE EXCEPTION 'Commitment state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.commitments SET status='completed',completed_at=v_timestamp,
          completed_by_uid=p_actor_uid,updated_at=v_timestamp WHERE id=v_id;
      ELSIF v_cmd.operation='cancel' THEN
        IF v_commitment.status<>'open' THEN
          RAISE EXCEPTION 'Commitment state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.commitments SET status='cancelled',completed_at=NULL,
          completed_by_uid=NULL,updated_at=v_timestamp WHERE id=v_id;
      ELSE
        IF v_commitment.status NOT IN ('completed','cancelled') THEN
          RAISE EXCEPTION 'Commitment state changed; preview again' USING ERRCODE='40001'; END IF;
        UPDATE public.commitments SET status='open',completed_at=NULL,
          completed_by_uid=NULL,updated_at=v_timestamp WHERE id=v_id;
      END IF;
    END IF;
    SELECT to_jsonb(c) INTO v_row FROM public.commitments AS c WHERE c.id=v_id;
  END IF;
  v_result:=jsonb_build_object('kind',v_cmd.kind,'operation',v_cmd.operation,
    'personId',v_cmd.person_id,'itemId',v_id,'item',v_row,'replayed',false);
  UPDATE public.crm_work_item_commands SET status='executed',result=v_result,
    confirmed_at=v_timestamp,executed_at=v_timestamp WHERE id=v_cmd.id;
  RETURN v_result;
END $execute$;

REVOKE ALL ON FUNCTION public.crm_work_item_preview_v1(text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_work_item_execute_v1(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_work_item_preview_v1(text,uuid,text,text,bigint,bigint,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_work_item_execute_v1(text,uuid) TO service_role;
COMMIT;
