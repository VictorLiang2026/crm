BEGIN;
SET LOCAL search_path = pg_catalog;
DO $roster_lookup$
DECLARE
  routine regprocedure := 'public.crm_activity_roster_v1(text,text,jsonb)'::regprocedure;
  definition text;
  body_digest text;
BEGIN
  SELECT pg_get_functiondef(oid), md5(translate(prosrc, chr(13), ''))
    INTO STRICT definition, body_digest FROM pg_proc WHERE oid = routine;
  IF body_digest = '2db9e472dd9191db2f399be7269e92ab' THEN RETURN; END IF;
  IF body_digest <> '75d4adb66c4f4fd03c9d273b77d8c461' THEN
    RAISE EXCEPTION 'Unexpected roster routine revision';
  END IF;
  -- Preserve the deployed definition and ACL. Only the lookup projection changes.
  EXECUTE replace(definition, 'x.name_key,x.organization,x.occupation', 'x.name_key,x.graduation_school,NULL::text AS organization,x.occupation');
  IF (SELECT md5(translate(prosrc, chr(13), '')) FROM pg_proc WHERE oid = routine) <> '2db9e472dd9191db2f399be7269e92ab' THEN
    RAISE EXCEPTION 'Roster lookup projection verification failed';
  END IF;
END
$roster_lookup$;
COMMIT;
