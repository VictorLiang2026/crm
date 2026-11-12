BEGIN;
SET LOCAL search_path = pg_catalog;
DO $migration$
DECLARE
  routine regprocedure := 'public.crm_activity_roster_v1(text,text,jsonb)'::regprocedure;
  definition text;
  body_hash text;
BEGIN
  SELECT pg_get_functiondef(oid), md5(replace(prosrc, chr(13), ''))
    INTO STRICT definition, body_hash FROM pg_proc WHERE oid = routine;
  IF body_hash = '11cfad2c60253e3c36d7238c64e03ab9' THEN RETURN; END IF;
  IF body_hash <> '4aa88a8fbd5c425c742a5f6d0101e463' THEN
    RAISE EXCEPTION 'Unexpected roster RPC revision';
  END IF;
  -- Keep the command record and change only the customer alias within the facts query.
  definition := replace(definition, 'customer_row."Id"', 'c."Id"');
  definition := replace(definition, 'ORDER BY "Id" LIMIT 1) AS customer_row ON true', 'ORDER BY "Id" LIMIT 1)c ON true');
  EXECUTE definition;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = routine) <> '11cfad2c60253e3c36d7238c64e03ab9' THEN
    RAISE EXCEPTION 'Unexpected roster RPC body after alias change';
  END IF;
END
$migration$;
COMMIT;
