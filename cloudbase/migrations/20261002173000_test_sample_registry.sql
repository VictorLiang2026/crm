-- WP02: empty protected registry only. No business/sample DML.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.crm_test_batches (
 batch_key text PRIMARY KEY CHECK (batch_key ~ '^crm_test_[a-z0-9][a-z0-9_]{0,47}$'),
 visible_marker text NOT NULL DEFAULT '【系统测试·勿联系】' CHECK (visible_marker = '【系统测试·勿联系】'),
 created_by_uid text NOT NULL CHECK (length(btrim(created_by_uid)) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_test_records (
 batch_key text NOT NULL REFERENCES public.crm_test_batches(batch_key),
 record_table text NOT NULL CHECK (record_table IN ('actions','activities','activity_participants','activity_speakers','activity_tasks','activity_topics','ai_recommendations','ai_results','ai_runs','ai_tasks','assistant_action_commands','commitments','context_items','customers','followups','gifts','household_members','households','interactions','knowledge_items','learnings','ocr_records','opportunities','opportunity_candidates','outcomes','person_roles','persons','photos','playbooks','policy_review_reports','products','recruit_candidates','recruit_followups','recruit_goal_benchmarks','recruit_goals','recruit_milestones','relationships')),
 record_id text NOT NULL CHECK (record_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
 origin text NOT NULL CHECK (origin IN ('initial','derived','ai_audit')),
 initial_slot smallint UNIQUE CHECK (initial_slot BETWEEN 1 AND 10),
 seed_key text CHECK (seed_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 parent_table text,
 parent_id text,
 visible_label text NOT NULL CHECK (position('【系统测试·勿联系】' IN visible_label) > 0 AND length(visible_label) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (batch_key, record_table, record_id),
 UNIQUE (batch_key, seed_key),
 FOREIGN KEY (batch_key,parent_table,parent_id) REFERENCES public.crm_test_records(batch_key,record_table,record_id),
 CHECK ((origin = 'initial' AND initial_slot IS NOT NULL AND seed_key IS NOT NULL AND parent_table IS NULL AND parent_id IS NULL)
     OR (origin <> 'initial' AND initial_slot IS NULL AND seed_key IS NULL AND parent_table IS NOT NULL AND parent_id IS NOT NULL)),
 CHECK ((origin = 'ai_audit') = (record_table IN ('ai_tasks','ai_runs','ai_results'))),
 CHECK (parent_table IS DISTINCT FROM record_table OR parent_id IS DISTINCT FROM record_id)
);
CREATE UNIQUE INDEX crm_test_initial_record_unique ON public.crm_test_records(record_table,record_id) WHERE origin = 'initial';
ALTER TABLE public.crm_test_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_test_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_test_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_test_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_test_batches, public.crm_test_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_test_batches, public.crm_test_records TO service_role;
CREATE POLICY crm_test_batches_service_only ON public.crm_test_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_test_records_service_only ON public.crm_test_records FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Narrow aggregate projection: no names, notes or record IDs returned.
-- The internal anon channel follows existing fn_only JWT semantics; public keys have sub.
CREATE FUNCTION public.crm_test_disclosure_v1(p_refs jsonb DEFAULT '[]'::jsonb, p_scope text DEFAULT 'refs')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE claims jsonb; output jsonb;
BEGIN
 claims := COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 IF NOT (COALESCE(claims->>'role','') = 'service_role'
    OR (COALESCE(claims->>'role','') = 'anon' AND claims->>'sub' IS NULL)) THEN
   RAISE EXCEPTION 'Test disclosure denied' USING ERRCODE = '42501';
 END IF;
 IF p_scope IS NULL OR p_scope NOT IN ('refs','funnel') OR p_refs IS NULL
   OR jsonb_typeof(p_refs) <> 'array' OR jsonb_array_length(p_refs) > 2000 THEN
   RAISE EXCEPTION 'Invalid test disclosure scope' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_refs) x
   WHERE jsonb_typeof(x) <> 'object' OR jsonb_typeof(x->'table') IS DISTINCT FROM 'string'
      OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string'
      OR (x->>'table') NOT IN ('actions','activities','activity_participants','activity_speakers','activity_tasks','activity_topics','ai_recommendations','ai_results','ai_runs','ai_tasks','assistant_action_commands','commitments','context_items','customers','followups','gifts','household_members','households','interactions','knowledge_items','learnings','ocr_records','opportunities','opportunity_candidates','outcomes','person_roles','persons','photos','playbooks','policy_review_reports','products','recruit_candidates','recruit_followups','recruit_goal_benchmarks','recruit_goals','recruit_milestones','relationships')
      OR (x->>'id') !~ '^[a-zA-Z0-9_-]{1,128}$') THEN
   RAISE EXCEPTION 'Invalid test disclosure reference' USING ERRCODE = '22023';
 END IF;
 WITH matched AS (
   SELECT r.batch_key,r.record_table,r.record_id FROM public.crm_test_records r
   WHERE (p_scope = 'refs' AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(p_refs) x WHERE x->>'table' = r.record_table AND x->>'id' = r.record_id
   )) OR (p_scope = 'funnel' AND (
     (r.record_table = 'customers' AND EXISTS (SELECT 1 FROM public.customers c WHERE c."Id"::text = r.record_id AND c.deleted_at IS NULL))
     OR (r.record_table = 'opportunities' AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id::text = r.record_id AND o.deleted_at IS NULL AND o.customer_id IS NOT NULL))
     OR (r.record_table = 'recruit_candidates' AND EXISTS (SELECT 1 FROM public.recruit_candidates c WHERE c.id::text = r.record_id AND c.deleted_at IS NULL))
     OR (r.record_table = 'followups' AND EXISTS (SELECT 1 FROM public.followups f JOIN public.customers c ON c."Id" = f.customer_id WHERE f."Id"::text = r.record_id AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.v_action_center a WHERE a.action_id = 'followup-' || r.record_id AND a.status = 'overdue')))
     OR (r.record_table = 'recruit_followups' AND EXISTS (SELECT 1 FROM public.recruit_followups f JOIN public.recruit_candidates c ON c.id = f.candidate_id WHERE f.id::text = r.record_id AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.v_action_center a WHERE a.action_id = 'recruit_followup-' || r.record_id AND a.status = 'overdue')))
   ))
 ), grouped AS (
   SELECT batch_key,record_table,count(*)::integer AS n FROM matched GROUP BY batch_key,record_table
 )
 SELECT jsonb_build_object('status','verified','containsTestData',EXISTS(SELECT 1 FROM matched),
   'recordCount',(SELECT count(DISTINCT (record_table,record_id)) FROM matched),
   'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('batchKey',batch_key,'table',record_table,'count',n) ORDER BY batch_key,record_table) FROM grouped),'[]'::jsonb))
 INTO output;
 RETURN output;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_test_disclosure_v1(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_test_disclosure_v1(jsonb,text) TO anon, service_role;
COMMIT;

