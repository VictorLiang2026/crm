-- PMC-14 diagnostics: surface the tcb channel's identity and row visibility via
-- intentional RAISE EXCEPTION (no data change).
DO $diag$
DECLARE
  u text; s text; v_pending int; v_total int;
BEGIN
  SELECT current_user, session_user INTO u, s;
  SELECT count(*) INTO v_total FROM public.activity_participants;
  SELECT count(*) INTO v_pending FROM public.activity_participants
    WHERE deleted_at IS NOT NULL AND person_type = 'customer' AND canonical_person_id IS NULL;
  RAISE EXCEPTION 'DIAG current_user=% session_user=% total_rows=% pending=%', u, s, v_total, v_pending;
END
$diag$;
