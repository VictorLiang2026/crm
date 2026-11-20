BEGIN;

-- Restore the pre-hardening direct grants. The existing service-role-only RLS
-- policies remain in place, so client roles still cannot read or write rows.
GRANT ALL PRIVILEGES ON TABLE
  public.daily_inspiration_quotes,
  public.daily_inspiration_settings,
  public.daily_inspiration_slots,
  public.daily_inspiration_history
TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE
  public.daily_inspiration_quotes,
  public.daily_inspiration_settings,
  public.daily_inspiration_slots,
  public.daily_inspiration_history
TO service_role;
GRANT ALL PRIVILEGES ON SEQUENCE
  public.daily_inspiration_quotes_id_seq,
  public.daily_inspiration_history_id_seq
TO anon, authenticated, service_role;

COMMIT;
