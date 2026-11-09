-- Person list import/export preview commands. All data stays in public.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regclass('public.crm_person_list_transfer_commands') IS NOT NULL THEN
    RAISE EXCEPTION 'Person list transfer command table already exists; inspect before migrating';
  END IF;
END
$guard$;

CREATE TABLE public.crm_person_list_transfer_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 4194304),
  preview jsonb NOT NULL CHECK (octet_length(preview::text) <= 4194304),
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(decisions) = 'object'),
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview','ready','executing','partial','completed','stale','expired')),
  result jsonb,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  executed_at timestamptz,
  UNIQUE (actor_uid, idempotency_key)
);

CREATE INDEX crm_person_list_transfer_actor_idx
  ON public.crm_person_list_transfer_commands (actor_uid, created_at DESC);
CREATE INDEX crm_person_list_transfer_expiry_idx
  ON public.crm_person_list_transfer_commands (expires_at)
  WHERE status IN ('preview','ready','partial');

ALTER TABLE public.crm_person_list_transfer_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_person_list_transfer_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_person_list_transfer_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_person_list_transfer_commands TO service_role;
CREATE POLICY crm_person_list_transfer_commands_service_only
  ON public.crm_person_list_transfer_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.crm_person_list_transfer_commands IS
  'Short-lived server-only previews and idempotent outcomes for Person list transfer; source rows are removed after expiry/completion.';
COMMIT;
