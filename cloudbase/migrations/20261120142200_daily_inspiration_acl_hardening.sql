BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.daily_inspiration_quotes,
  public.daily_inspiration_settings,
  public.daily_inspiration_slots,
  public.daily_inspiration_history
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.daily_inspiration_quotes,
  public.daily_inspiration_settings,
  public.daily_inspiration_slots
TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.daily_inspiration_history TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.daily_inspiration_quotes_id_seq,
  public.daily_inspiration_history_id_seq
FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE
  public.daily_inspiration_quotes_id_seq,
  public.daily_inspiration_history_id_seq
TO service_role;

COMMIT;
