-- Production SDK canary: affects only two reserved synthetic rows. No client contact.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';
DO $x$ BEGIN
 IF EXISTS (SELECT 1 FROM public.customers WHERE "Id"=-211109071 OR person_id=-211109071) OR EXISTS (SELECT 1 FROM public.persons WHERE id=-211109071 OR name_key='device_canary_211109071')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class src ON src.oid=fk.conrelid WHERE fk.contype='f' AND fk.confrelid IN ('public.persons'::regclass,'public.customers'::regclass) AND (src.relnamespace <> 'public'::regnamespace OR left(src.relname,3)='pr_')) THEN RAISE EXCEPTION 'Canary blocked: collision or out-of-scope dependency'; END IF;
END $x$;
CREATE POLICY persons_device_synthetic_canary ON public.persons AS RESTRICTIVE FOR SELECT TO anon USING
 (id <> -211109071 OR ((NULLIF(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role')='anon' AND NOT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb ? 'sub')));
INSERT INTO public.persons(id,display_name,name_key) OVERRIDING SYSTEM VALUE VALUES (-211109071,'【系统测试·勿联系】设备权限合成校验','device_canary_211109071');
INSERT INTO public.customers("Id",person_id,additional_info) OVERRIDING SYSTEM VALUE VALUES (-211109071,-211109071,'DEVICE_CANARY_211109071');
COMMIT;
