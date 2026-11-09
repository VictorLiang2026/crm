-- Remove only the just-created fixture; refuse on unknown FK references.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='25s';
DO $guard$
DECLARE ref record; linked boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.persons WHERE id=-211109071 AND name_key='device_canary_211109071') OR NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=-211109071 AND person_id=-211109071 AND additional_info='DEVICE_CANARY_211109071') THEN RAISE EXCEPTION 'Canary fingerprint mismatch'; END IF;
 FOR ref IN SELECT rel.relnamespace, rel.relname, att.attname, fk.confrelid FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class rel ON rel.oid=fk.conrelid JOIN pg_catalog.pg_attribute att ON att.attrelid=fk.conrelid AND att.attnum=fk.conkey[1] WHERE fk.contype='f' AND fk.confrelid IN ('public.customers'::regclass,'public.persons'::regclass)
 LOOP
 IF ref.relnamespace <> 'public'::regnamespace OR left(ref.relname,3)='pr_' THEN RAISE EXCEPTION 'Out-of-scope dependency'; END IF;
 IF ref.relname='customers' AND ref.attname='person_id' THEN
  IF EXISTS(SELECT 1 FROM public.customers WHERE person_id=-211109071 AND "Id"<>-211109071) THEN RAISE EXCEPTION 'Another customer linked'; END IF;
  CONTINUE;
 END IF;
 IF ref.relname='person_roles' AND ref.attname='person_id' THEN
  IF EXISTS(SELECT 1 FROM public.person_roles WHERE person_id=-211109071 AND origin IS DISTINCT FROM 'derived') THEN RAISE EXCEPTION 'Non-derived role'; END IF;
  CONTINUE;
 END IF;
 EXECUTE format('SELECT EXISTS(SELECT FROM public.%I WHERE %I=$1)',ref.relname,ref.attname) INTO linked USING -211109071;
 IF linked THEN RAISE EXCEPTION 'Canary acquired another reference in %',ref.relname; END IF;
 END LOOP;
END $guard$;
DELETE FROM public.customers WHERE "Id"=-211109071 AND person_id=-211109071 AND additional_info='DEVICE_CANARY_211109071';
DELETE FROM public.persons WHERE id=-211109071 AND name_key='device_canary_211109071';
DROP POLICY persons_device_synthetic_canary ON public.persons;
COMMIT;
