ALTER TABLE public.activity_participants ALTER COLUMN person_id TYPE bigint;
ALTER TABLE public.activity_speakers ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_speakers_fn_only ON public.activity_speakers FOR ALL TO anon USING ((((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text) IS NULL) AND (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'anon'::text)) WITH CHECK ((((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text) IS NULL) AND (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'anon'::text));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_speakers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.activity_speakers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.activity_speakers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.activity_speakers TO cloudbase_postgres_pgdb_pn3idppt;
GRANT USAGE, SELECT ON SEQUENCE activity_speakers_id_seq TO anon, authenticated;
