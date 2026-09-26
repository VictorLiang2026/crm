-- Manual rollback only. Refuse to erase new or edited role assignments.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.person_roles IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.person_roles
             WHERE origin <> 'legacy_backfill' OR updated_at IS DISTINCT FROM created_at) THEN
    RAISE EXCEPTION 'person_roles rollback refused: manual or edited roles exist';
  END IF;
END $guard$;
DROP TABLE public.person_roles RESTRICT;
COMMIT;
