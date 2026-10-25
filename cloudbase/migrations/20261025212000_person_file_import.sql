-- L04b: standalone originals reuse import jobs; identity + reviewed fields commit atomically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.crm_file_import_v1(text,text,jsonb)'::regprocedure))<>'b6109a300610db7dfbf8aad85fa7f376' OR
    to_regclass('public.crm_person_file_commands') IS NOT NULL OR
    to_regprocedure('public.crm_person_file_v1(text,text,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'L04b baseline changed; inspect before migrating'; END IF;
END $guard$;
ALTER TABLE public.crm_file_import_jobs
 ALTER COLUMN person_id DROP NOT NULL, ALTER COLUMN customer_id DROP NOT NULL, ALTER COLUMN photo_id DROP NOT NULL,
 ADD COLUMN original_data text, ADD COLUMN raw_text text, ADD COLUMN apply_command_id uuid,
 ADD CONSTRAINT crm_file_import_jobs_mode_check CHECK (
  (customer_id IS NOT NULL AND person_id IS NOT NULL AND photo_id IS NOT NULL AND original_data IS NULL AND raw_text IS NULL AND apply_command_id IS NULL)
  OR (customer_id IS NULL AND photo_id IS NULL AND ocr_record_id IS NULL AND original_data IS NOT NULL AND
      octet_length(original_data)<=5592541 AND (raw_text IS NULL OR length(raw_text)<=100000) AND
      ((person_id IS NULL AND apply_command_id IS NULL) OR (person_id IS NOT NULL AND apply_command_id IS NOT NULL))));
CREATE INDEX crm_file_import_jobs_standalone_idx ON public.crm_file_import_jobs(actor_uid,created_at DESC,id DESC) WHERE customer_id IS NULL;
CREATE TABLE public.crm_person_file_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_uid text NOT NULL CHECK(length(btrim(actor_uid)) BETWEEN 1 AND 128),
 idempotency_key uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.crm_file_import_jobs(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('apply','undo')), identity_preview_id uuid, parent_id uuid,
 payload jsonb NOT NULL, preview jsonb NOT NULL, job_version timestamptz NOT NULL,
 person_id bigint, person_version timestamptz, before_state jsonb NOT NULL, after_state jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','executed','undone')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 result jsonb, executed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_uid,idempotency_key),
 CHECK((operation='apply' AND identity_preview_id IS NOT NULL AND parent_id IS NULL) OR
       (operation='undo' AND identity_preview_id IS NULL AND parent_id IS NOT NULL))
);
CREATE INDEX crm_person_file_commands_job_idx ON public.crm_person_file_commands(actor_uid,job_id,created_at DESC);
ALTER TABLE public.crm_person_file_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_person_file_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_person_file_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_person_file_commands TO service_role;
CREATE POLICY crm_person_file_commands_service_only ON public.crm_person_file_commands FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_person_file_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 j public.crm_file_import_jobs%ROWTYPE; c public.crm_person_file_commands%ROWTYPE;
 parent public.crm_person_file_commands%ROWTYPE; ident public.person_identity_commands%ROWTYPE;
 p public.persons%ROWTYPE; patched public.persons%ROWTYPE;
 key uuid; pid bigint; pg integer; rows_json jsonb; result_json jsonb; selected jsonb;
 before_json jsonb; after_json jsonb; source_value text; k text; version_time timestamptz;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Unauthorized person file'; END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('save','list','get','claim','complete','fail','preview','undo_preview','execute') OR
    jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid person file operation'; END IF;
 IF p_operation='list' THEN
  pg:=coalesce((p_data->>'page')::integer,1);pid:=nullif(p_data->>'personId','')::bigint;
  IF pg NOT BETWEEN 1 AND 10000 OR pid<1 THEN RAISE EXCEPTION 'Invalid person file page'; END IF;
  IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.persons WHERE id=pid AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Invalid active Person'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO rows_json FROM (
   SELECT q.id,q.person_id,q.file_name,q.content_type,q.status,q.error_code,q.attempts,q.lease_expires_at,q.created_at,q.updated_at,q.apply_command_id,
     (q.person_id IS NULL OR EXISTS(SELECT 1 FROM public.persons p WHERE p.id=q.person_id AND p.deleted_at IS NULL)) AS "sourceAvailable"
   FROM public.crm_file_import_jobs q WHERE q.actor_uid=p_actor_uid AND q.customer_id IS NULL AND
      (pid IS NULL OR q.person_id=pid)
   ORDER BY q.created_at DESC,q.id DESC LIMIT 21 OFFSET (pg-1)*20
  ) x;
  RETURN jsonb_build_object('rows',CASE WHEN jsonb_array_length(rows_json)>20 THEN rows_json-20 ELSE rows_json END,
   'page',pg,'pageSize',20,'hasMore',jsonb_array_length(rows_json)>20,'total',NULL);
 END IF;
 IF p_operation='save' THEN
  key:=(p_data->>'idempotencyKey')::uuid;
  IF key IS NULL OR coalesce(p_data->>'payloadHash','') !~ '^[a-f0-9]{64}$' OR
     length(coalesce(p_data->>'fileName','')) NOT BETWEEN 1 AND 255 OR
     length(coalesce(p_data->>'contentType','')) NOT BETWEEN 3 AND 120 OR
     coalesce(p_data->>'contentType','') !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' OR
     length(coalesce(p_data->>'base64','')) NOT BETWEEN 4 AND 5592408 OR
     coalesce(p_data->>'base64','') !~ '^[A-Za-z0-9+/]+={0,2}$' OR
     octet_length(decode(p_data->>'base64','base64'))>4194304 THEN RAISE EXCEPTION 'Invalid person file content'; END IF;
  source_value:='data:'||(p_data->>'contentType')||';base64,'||(p_data->>'base64');
  PERFORM pg_advisory_xact_lock(hashtextextended('file-import:'||p_actor_uid||':'||key::text,0));
  SELECT * INTO j FROM public.crm_file_import_jobs WHERE actor_uid=p_actor_uid AND idempotency_key=key FOR UPDATE;
  IF FOUND THEN
   IF j.customer_id IS NOT NULL OR j.payload_hash IS DISTINCT FROM p_data->>'payloadHash' OR j.original_data IS DISTINCT FROM source_value THEN
    RAISE EXCEPTION 'Idempotency key conflicts with person file'; END IF;
  ELSE
   INSERT INTO public.crm_file_import_jobs(actor_uid,idempotency_key,file_name,content_type,payload_hash,source_digest,original_data)
    VALUES(p_actor_uid,key,p_data->>'fileName',p_data->>'contentType',p_data->>'payloadHash',md5(source_value),source_value) RETURNING * INTO j;
  END IF;
 ELSIF p_operation='execute' THEN
  SELECT * INTO c FROM public.crm_person_file_commands WHERE id=(p_data->>'previewId')::uuid AND actor_uid=p_actor_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid person file preview'; END IF;
  -- Serialize every state-changing path on the job before locking its commands.
  SELECT * INTO j FROM public.crm_file_import_jobs WHERE id=c.job_id AND actor_uid=p_actor_uid AND customer_id IS NULL FOR UPDATE;
  SELECT * INTO c FROM public.crm_person_file_commands WHERE id=c.id AND actor_uid=p_actor_uid FOR UPDATE;
  IF c.status IN ('executed','undone') THEN RETURN c.result||jsonb_build_object('replayed',true,'commandStatus',c.status); END IF;
 ELSE
  SELECT * INTO j FROM public.crm_file_import_jobs WHERE id=(p_data->>'jobId')::uuid AND actor_uid=p_actor_uid AND customer_id IS NULL FOR UPDATE;
 END IF;
 IF j.id IS NULL OR j.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid person file job'; END IF;
 IF j.original_data IS NULL OR md5(j.original_data) IS DISTINCT FROM j.source_digest THEN
  RAISE EXCEPTION 'Invalid person file source'; END IF;
 IF j.person_id IS NOT NULL THEN
  SELECT * INTO p FROM public.persons WHERE id=j.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid active Person'; END IF;
 END IF;
 IF p_operation='get' THEN
  RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data'],
   'source',jsonb_build_object('photo_url',j.original_data,'content_type',j.content_type,'file_name',j.file_name));
 ELSIF p_operation='claim' THEN
  IF j.status<>'draft' AND (j.status<>'parsing' OR j.lease_expires_at<=clock_timestamp()) THEN
   UPDATE public.crm_file_import_jobs SET status='parsing',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+interval '2 minutes',error_code=NULL,updated_at=clock_timestamp()
    WHERE id=j.id RETURNING * INTO j;
   RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data','raw_text'],
    'leaseToken',j.lease_token,'source',jsonb_build_object('photo_url',j.original_data,'content_type',j.content_type,'file_name',j.file_name));
  END IF;
 ELSIF p_operation IN ('complete','fail') THEN
  IF j.status<>'draft' THEN
   IF j.status<>'parsing' OR j.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid OR j.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid person file lease'; END IF;
   IF p_operation='fail' THEN
    IF coalesce(p_data->>'errorCode','') NOT IN ('SOURCE_UNAVAILABLE','UNSUPPORTED_TYPE','INVALID_CONTENT','INVALID_RESULT','PARSE_FAILED','PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT') THEN
     RAISE EXCEPTION 'Invalid person file error'; END IF;
    UPDATE public.crm_file_import_jobs SET status='failed',error_code=p_data->>'errorCode',lease_expires_at=NULL,updated_at=clock_timestamp()
     WHERE id=j.id RETURNING * INTO j;
   ELSE
    selected:=p_data->'fields';
    IF jsonb_typeof(selected) IS DISTINCT FROM 'object' OR length(coalesce(p_data->>'rawText','')) NOT BETWEEN 1 AND 100000 THEN
     RAISE EXCEPTION 'Invalid person file draft'; END IF;
    FOR k IN SELECT jsonb_object_keys(selected) LOOP
     IF k NOT IN ('customer_name','phone','gender','birthday','occupation','education','marital_status','customer_stage','sales_priority','referral_priority','hobbies','source','additional_info') OR
        jsonb_typeof(selected->k)<>'string' OR length(selected->>k)>8000 THEN RAISE EXCEPTION 'Invalid person file field'; END IF;
    END LOOP;
    UPDATE public.crm_file_import_jobs SET status='draft',parsed_fields=selected,raw_text=p_data->>'rawText',
      error_code=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
   END IF;
  END IF;
 ELSIF p_operation IN ('preview','undo_preview') THEN
  key:=(p_data->>'idempotencyKey')::uuid;
  IF key IS NULL THEN RAISE EXCEPTION 'Invalid person file request key'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('person-file-command:'||p_actor_uid||':'||key::text,0));
  SELECT * INTO c FROM public.crm_person_file_commands WHERE actor_uid=p_actor_uid AND idempotency_key=key;
  IF FOUND THEN
   IF c.job_id<>j.id OR c.payload<>p_data OR c.operation<>(CASE WHEN p_operation='preview' THEN 'apply' ELSE 'undo' END) THEN
    RAISE EXCEPTION 'Idempotency key conflicts with person file preview'; END IF;
   RETURN jsonb_build_object('previewId',c.id,'preview',c.preview,'expiresAt',c.expires_at,'status',c.status,'result',c.result);
  END IF;
  IF j.status<>'draft' THEN RAISE EXCEPTION 'Invalid person file draft state'; END IF;
  IF p_operation='preview' THEN
   IF j.person_id IS NOT NULL OR j.apply_command_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid person file already applied'; END IF;
   SELECT * INTO ident FROM public.person_identity_commands WHERE id=(p_data->>'identityPreviewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
   IF NOT FOUND OR ident.kind<>'person' OR ident.status<>'preview' OR ident.expires_at<=clock_timestamp() OR
      ident.payload->>'source' IS DISTINCT FROM '人工新增' OR coalesce(ident.payload->>'occupation','')<>'' OR coalesce(ident.payload->>'organization','')<>'' OR coalesce(ident.payload->>'education','')<>'' THEN
    RAISE EXCEPTION 'Invalid person file identity preview'; END IF;
   pid:=nullif(ident.payload->>'person_id','')::bigint;
   IF pid IS NOT NULL THEN
    SELECT * INTO p FROM public.persons WHERE id=pid AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid active Person'; END IF;
   ELSE p:=NULL; END IF;
   selected:=p_data->'fields';
   IF jsonb_typeof(selected) IS DISTINCT FROM 'object' OR length(selected::text)>16000 THEN RAISE EXCEPTION 'Invalid person file selected fields'; END IF;
   FOR k IN SELECT jsonb_object_keys(selected) LOOP
    IF k NOT IN ('phone','gender','birthday','occupation','education','marital_status','hobbies','source','notes') OR
      jsonb_typeof(selected->k)<>'string' OR length(btrim(selected->>k)) NOT BETWEEN 1 AND (CASE k WHEN 'notes' THEN 8000 WHEN 'occupation' THEN 200 WHEN 'education' THEN 120 WHEN 'birthday' THEN 10 ELSE 500 END) THEN
     RAISE EXCEPTION 'Invalid person file selected fields'; END IF;
   END LOOP;
   IF selected ? 'birthday' THEN
    IF selected->>'birthday' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid person file birthday'; END IF;
    PERFORM (selected->>'birthday')::date;
   END IF;
   IF selected ? 'gender' AND selected->>'gender' NOT IN ('男','女','未知') THEN RAISE EXCEPTION 'Invalid person file gender'; END IF;
   SELECT coalesce(jsonb_object_agg(k,CASE WHEN pid IS NULL AND k='source' THEN to_jsonb('人工新增'::text) ELSE coalesce(to_jsonb(p)->k,'null'::jsonb) END),'{}') INTO before_json FROM jsonb_object_keys(selected) k;
   after_json:=selected;
   result_json:=jsonb_build_object('operation','apply','jobId',j.id,'fileName',j.file_name,'personId',pid,
    'displayName',ident.payload->>'display_name','newPerson',pid IS NULL,'before',before_json,'after',after_json,'willCreateCustomer',false);
  ELSE
   SELECT * INTO parent FROM public.crm_person_file_commands WHERE id=(p_data->>'commandId')::uuid AND actor_uid=p_actor_uid AND job_id=j.id FOR UPDATE;
   IF NOT FOUND OR parent.status<>'executed' OR parent.operation<>'apply' OR j.apply_command_id IS DISTINCT FROM parent.id OR
      j.person_id IS DISTINCT FROM parent.person_id OR p.updated_at IS DISTINCT FROM parent.person_version THEN RAISE EXCEPTION 'Invalid person file undo conflict'; END IF;
   before_json:=parent.after_state;after_json:=parent.before_state;pid:=parent.person_id;
   result_json:=jsonb_build_object('operation','undo','jobId',j.id,'fileName',j.file_name,'personId',pid,
    'displayName',p.display_name,'before',before_json,'after',after_json,'keepsPerson',true);
  END IF;
  IF pid IS NOT NULL AND EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
     WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=pid::text) THEN
   RAISE EXCEPTION 'Test account requires tracked fictional Person'; END IF;
  INSERT INTO public.crm_person_file_commands(actor_uid,idempotency_key,job_id,operation,identity_preview_id,parent_id,payload,preview,
      job_version,person_id,person_version,before_state,after_state)
   VALUES(p_actor_uid,key,j.id,CASE WHEN p_operation='preview' THEN 'apply' ELSE 'undo' END,
    CASE WHEN p_operation='preview' THEN ident.id ELSE NULL END,CASE WHEN p_operation='undo_preview' THEN parent.id ELSE NULL END,
    p_data,result_json,j.updated_at,pid,p.updated_at,before_json,after_json) RETURNING * INTO c;
  RETURN jsonb_build_object('previewId',c.id,'preview',c.preview,'expiresAt',c.expires_at,'status',c.status);
 ELSIF p_operation='execute' THEN
  IF c.status<>'preview' OR c.expires_at<=clock_timestamp() OR j.status<>'draft' OR j.updated_at IS DISTINCT FROM c.job_version THEN
   RAISE EXCEPTION 'Invalid person file preview expired or changed'; END IF;
  IF c.operation='apply' THEN
   IF j.person_id IS NOT NULL OR j.apply_command_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid person file already applied'; END IF;
   SELECT * INTO ident FROM public.person_identity_commands WHERE id=c.identity_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
   IF NOT FOUND OR ident.kind<>'person' OR ident.status<>'preview' OR ident.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid person file identity changed'; END IF;
   result_json:=public.person_identity_execute_v1(p_actor_uid,ident.id);
   pid:=(result_json->>'personId')::bigint;
   SELECT * INTO p FROM public.persons WHERE id=pid AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND OR (c.person_id IS NOT NULL AND (pid<>c.person_id OR p.updated_at IS DISTINCT FROM c.person_version)) THEN
    RAISE EXCEPTION 'Invalid person file Person changed'; END IF;
  ELSE
   SELECT * INTO parent FROM public.crm_person_file_commands WHERE id=c.parent_id AND actor_uid=p_actor_uid AND job_id=j.id FOR UPDATE;
   IF NOT FOUND OR parent.status<>'executed' OR parent.operation<>'apply' OR j.apply_command_id IS DISTINCT FROM parent.id OR
      p.id IS DISTINCT FROM c.person_id OR p.updated_at IS DISTINCT FROM c.person_version THEN
    RAISE EXCEPTION 'Invalid person file undo conflict'; END IF;
   pid:=c.person_id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
     WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=pid::text) THEN
   RAISE EXCEPTION 'Test account requires tracked fictional Person'; END IF;
  -- Only the explicit reviewed whitelist is updated; no roles, facts, tasks or name edits.
  patched:=jsonb_populate_record(p,c.after_state);
  IF c.after_state<>'{}'::jsonb THEN
   UPDATE public.persons SET phone=patched.phone,gender=patched.gender,birthday=patched.birthday,occupation=patched.occupation,
    education=patched.education,marital_status=patched.marital_status,hobbies=patched.hobbies,source=patched.source,notes=patched.notes,
    updated_at=clock_timestamp() WHERE id=pid RETURNING * INTO p;
  END IF;
  UPDATE public.crm_file_import_jobs SET person_id=CASE WHEN c.operation='apply' THEN pid ELSE NULL END,
   apply_command_id=CASE WHEN c.operation='apply' THEN c.id ELSE NULL END,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  result_json:=jsonb_build_object('ok',true,'commandId',c.id,'operation',c.operation,'jobId',j.id,'personId',pid,
   'newPerson',coalesce((c.preview->>'newPerson')::boolean,false),'keepsPerson',true,'replayed',false);
  UPDATE public.crm_person_file_commands SET status='executed',result=result_json,executed_at=clock_timestamp(),
   person_id=pid,person_version=p.updated_at WHERE id=c.id;
  IF c.operation='undo' THEN UPDATE public.crm_person_file_commands SET status='undone' WHERE id=c.parent_id; END IF;
  RETURN result_json;
 END IF;
 RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data','raw_text']);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_person_file_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_person_file_v1(text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.crm_file_import_v1(p_actor_uid text, p_operation text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 j public.crm_file_import_jobs%ROWTYPE; p public.persons%ROWTYPE; c public.customers%ROWTYPE;
 f public.photos%ROWTYPE; person_key bigint; customer_key integer; photo_key integer; ocr_key bigint;
 request_key uuid; page_no integer; rows_json jsonb; fields jsonb; v text;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Unauthorized file import';
 END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('save','list','claim','complete','fail') OR
    p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Invalid file import operation'; END IF;
 IF p_operation IN ('save','list') THEN
   IF coalesce(p_data->>'personId','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'Invalid file import Person'; END IF;
   person_key := (p_data->>'personId')::bigint;
 ELSE
   SELECT * INTO j FROM public.crm_file_import_jobs WHERE id=(p_data->>'jobId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid file import job'; END IF;
   person_key:=j.person_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND NOT EXISTS(
   SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
   WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons' AND r.record_id=person_key::text
 ) THEN RAISE EXCEPTION 'Test account requires tracked fictional Person'; END IF;
 SELECT * INTO p FROM public.persons WHERE id=person_key AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid file import active Person'; END IF;

 IF p_operation='list' THEN
   page_no:=coalesce((p_data->>'page')::integer,1);
   IF page_no NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid file import page'; END IF;
   SELECT coalesce(jsonb_agg(x.row_data ORDER BY x.created_at DESC,x.id DESC),'[]') INTO rows_json FROM (
     SELECT q.id,q.created_at,(to_jsonb(q)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data','raw_text','apply_command_id']) || jsonb_build_object(
       'sourceAvailable',EXISTS(SELECT 1 FROM public.photos ph JOIN public.customers cu ON cu."Id"=ph.customer_id
          WHERE ph.id=q.photo_id AND ph.customer_id=q.customer_id AND ph.deleted_at IS NULL
            AND cu.person_id=person_key AND cu.deleted_at IS NULL AND md5(ph.photo_url)=q.source_digest),
       'draftAvailable',EXISTS(SELECT 1 FROM public.ocr_records o WHERE o.id=q.ocr_record_id AND o.customer_id=q.customer_id AND o.deleted_at IS NULL)) AS row_data
     FROM public.crm_file_import_jobs q WHERE q.actor_uid=p_actor_uid AND q.person_id=person_key AND q.customer_id IS NOT NULL
     ORDER BY q.created_at DESC,q.id DESC LIMIT 21 OFFSET (page_no-1)*20
   ) x;
   RETURN jsonb_build_object('rows',CASE WHEN jsonb_array_length(rows_json)>20 THEN rows_json-20 ELSE rows_json END,
     'page',page_no,'pageSize',20,'hasMore',jsonb_array_length(rows_json)>20,'total',NULL);
 END IF;
 IF p_operation='save' THEN
   IF coalesce(p_data->>'customerId','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'Invalid file import customer'; END IF;
   customer_key:=(p_data->>'customerId')::integer;
 ELSE customer_key:=j.customer_id; END IF;
 SELECT * INTO c FROM public.customers WHERE "Id"=customer_key AND person_id=person_key AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid file import customer association'; END IF;
 IF p_operation='save' THEN
   request_key:=(p_data->>'idempotencyKey')::uuid;
   IF request_key IS NULL OR coalesce(p_data->>'payloadHash','') !~ '^[a-f0-9]{64}$' OR
      length(coalesce(p_data->>'fileName','')) NOT BETWEEN 1 AND 255 OR
      length(coalesce(p_data->>'contentType','')) NOT BETWEEN 3 AND 120 OR
      coalesce(p_data->>'contentType','') !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' OR
      length(coalesce(p_data->>'base64','')) NOT BETWEEN 4 AND 5592408 OR
      coalesce(p_data->>'base64','') !~ '^[A-Za-z0-9+/]+={0,2}$' OR
      octet_length(decode(p_data->>'base64','base64'))>4194304 OR
      length(coalesce(p_data->>'notes',''))>4000 THEN RAISE EXCEPTION 'Invalid file import content'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('file-import:'||p_actor_uid||':'||request_key::text,0));
   SELECT * INTO j FROM public.crm_file_import_jobs WHERE actor_uid=p_actor_uid AND idempotency_key=request_key FOR UPDATE;
   IF FOUND THEN
     IF j.payload_hash<>p_data->>'payloadHash' OR j.person_id<>person_key OR j.customer_id<>customer_key THEN
       RAISE EXCEPTION 'Idempotency key conflicts with file import';
     END IF;
   ELSE
     INSERT INTO public.photos(customer_id,customer_name,photo_url,file_name,content_type,photo_notes,category)
       VALUES(customer_key,p.display_name,'data:'||(p_data->>'contentType')||';base64,'||(p_data->>'base64'),
         p_data->>'fileName',p_data->>'contentType',coalesce(p_data->>'notes',''),'attachment') RETURNING id INTO photo_key;
     INSERT INTO public.crm_file_import_jobs(actor_uid,idempotency_key,person_id,customer_id,photo_id,file_name,content_type,payload_hash,source_digest)
       VALUES(p_actor_uid,request_key,person_key,customer_key,photo_key,p_data->>'fileName',p_data->>'contentType',p_data->>'payloadHash',
         md5('data:'||(p_data->>'contentType')||';base64,'||(p_data->>'base64'))) RETURNING * INTO j;
   END IF;
 ELSE
   SELECT * INTO f FROM public.photos WHERE id=j.photo_id AND customer_id=j.customer_id AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND OR md5(f.photo_url)<>j.source_digest OR f.content_type IS DISTINCT FROM j.content_type THEN
     RAISE EXCEPTION 'Invalid file import source unavailable or changed';
   END IF;
   IF j.status='draft' THEN
     IF NOT EXISTS(SELECT 1 FROM public.ocr_records WHERE id=j.ocr_record_id AND customer_id=j.customer_id AND deleted_at IS NULL) THEN
       RAISE EXCEPTION 'Invalid file import draft unavailable';
     END IF;
   ELSIF p_operation='claim' THEN
     IF j.status<>'parsing' OR j.lease_expires_at<=clock_timestamp() THEN
       UPDATE public.crm_file_import_jobs SET status='parsing',attempts=attempts+1,lease_token=gen_random_uuid(),
         lease_expires_at=clock_timestamp()+interval '2 minutes',error_code=NULL,updated_at=clock_timestamp()
         WHERE id=j.id RETURNING * INTO j;
       RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data','raw_text','apply_command_id'],
         'leaseToken',j.lease_token,'source',jsonb_build_object('photo_url',f.photo_url,'content_type',f.content_type,'file_name',f.file_name));
     END IF;
   ELSE
     IF j.status<>'parsing' OR j.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid OR
        j.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invalid file import lease'; END IF;
     IF p_operation='fail' THEN
       IF coalesce(p_data->>'errorCode','') NOT IN ('SOURCE_UNAVAILABLE','UNSUPPORTED_TYPE','INVALID_CONTENT','INVALID_RESULT','PARSE_FAILED','PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT') THEN
         RAISE EXCEPTION 'Invalid file import error code'; END IF;
       UPDATE public.crm_file_import_jobs SET status='failed',error_code=p_data->>'errorCode',lease_expires_at=NULL,
         updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
     ELSE
       fields:=p_data->'fields';
       IF fields IS NULL OR jsonb_typeof(fields)<>'object' OR
          length(coalesce(p_data->>'rawText','')) NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid file import draft'; END IF;
       FOR v IN SELECT jsonb_object_keys(fields) LOOP
         IF v NOT IN ('customer_name','phone','gender','birthday','occupation','education','marital_status','customer_stage',
             'sales_priority','referral_priority','hobbies','source','additional_info') OR
            jsonb_typeof(fields->v)<>'string' OR length(fields->>v)>8000 THEN RAISE EXCEPTION 'Invalid file import field'; END IF;
       END LOOP;
       INSERT INTO public.ocr_records(customer_id,summary,raw_text,file_ids,file_names,updated_at)
         VALUES(j.customer_id,j.file_name,p_data->>'rawText',jsonb_build_array(j.photo_id)::text,
           jsonb_build_array(j.file_name)::text,clock_timestamp()) RETURNING id INTO ocr_key;
       UPDATE public.crm_file_import_jobs SET status='draft',ocr_record_id=ocr_key,parsed_fields=fields,
         error_code=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
     END IF;
   END IF;
 END IF;
 RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token','original_data','raw_text','apply_command_id']);
END $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;

