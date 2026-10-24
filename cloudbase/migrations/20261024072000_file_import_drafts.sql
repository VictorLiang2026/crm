-- M08: originals and actor-bound parsing drafts. No existing columns/views are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
 IF to_regclass('public.crm_file_import_jobs') IS NOT NULL OR
    to_regprocedure('public.crm_file_import_v1(text,text,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'M08 objects already exist; inspect before migration';
 END IF;
END $guard$;
CREATE TABLE public.crm_file_import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_uid text NOT NULL CHECK(length(btrim(actor_uid)) BETWEEN 1 AND 128),
 idempotency_key uuid NOT NULL,
 person_id bigint NOT NULL,
 customer_id integer NOT NULL,
 -- Audit IDs intentionally have no legacy FKs: preserve old delete/restore behavior.
 photo_id integer NOT NULL,
 ocr_record_id bigint,
 file_name text NOT NULL,
 content_type text NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 source_digest text NOT NULL,
 status text NOT NULL DEFAULT 'saved' CHECK(status IN ('saved','parsing','failed','draft')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_token uuid,
 lease_expires_at timestamptz,
 parsed_fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(parsed_fields)='object'),
 error_code text CHECK(error_code IN ('SOURCE_UNAVAILABLE','UNSUPPORTED_TYPE','INVALID_CONTENT','INVALID_RESULT','PARSE_FAILED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_uid,idempotency_key)
);
CREATE INDEX crm_file_import_jobs_actor_person_idx ON public.crm_file_import_jobs(actor_uid,person_id,created_at DESC,id DESC);
ALTER TABLE public.crm_file_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_file_import_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_file_import_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_file_import_jobs TO service_role;
CREATE POLICY crm_file_import_jobs_service_only ON public.crm_file_import_jobs FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_file_import_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
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
     SELECT q.id,q.created_at,(to_jsonb(q)-ARRAY['actor_uid','payload_hash','source_digest','lease_token']) || jsonb_build_object(
       'sourceAvailable',EXISTS(SELECT 1 FROM public.photos ph JOIN public.customers cu ON cu."Id"=ph.customer_id
          WHERE ph.id=q.photo_id AND ph.customer_id=q.customer_id AND ph.deleted_at IS NULL
            AND cu.person_id=person_key AND cu.deleted_at IS NULL AND md5(ph.photo_url)=q.source_digest),
       'draftAvailable',EXISTS(SELECT 1 FROM public.ocr_records o WHERE o.id=q.ocr_record_id AND o.customer_id=q.customer_id AND o.deleted_at IS NULL)) AS row_data
     FROM public.crm_file_import_jobs q WHERE q.actor_uid=p_actor_uid AND q.person_id=person_key
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
       RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token'],
         'leaseToken',j.lease_token,'source',jsonb_build_object('photo_url',f.photo_url,'content_type',f.content_type,'file_name',f.file_name));
     END IF;
   ELSE
     IF j.status<>'parsing' OR j.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid OR
        j.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invalid file import lease'; END IF;
     IF p_operation='fail' THEN
       IF coalesce(p_data->>'errorCode','') NOT IN ('SOURCE_UNAVAILABLE','UNSUPPORTED_TYPE','INVALID_CONTENT','INVALID_RESULT','PARSE_FAILED') THEN
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
 RETURN jsonb_build_object('job',to_jsonb(j)-ARRAY['actor_uid','payload_hash','source_digest','lease_token']);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_file_import_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_file_import_v1(text,text,jsonb) TO service_role;
COMMENT ON TABLE public.crm_file_import_jobs IS 'M08 original-file receipt and AI draft only; PC14 human confirmation applies business fields.';
NOTIFY pgrst,'reload schema';
COMMIT;
