-- Manual rollback only. Refuse to erase a family context or confirmed membership.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.household_members, public.households IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.households LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.household_members LIMIT 1) THEN
    RAISE EXCEPTION 'households rollback refused: family data exists';
  END IF;
END $guard$;
DROP TABLE public.household_members RESTRICT;
DROP TABLE public.households RESTRICT;
COMMIT;
