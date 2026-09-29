-- Manual rollback only. Refuse to discard authored playbook content or dependents.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.playbooks IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.playbooks LIMIT 1) THEN
    RAISE EXCEPTION 'playbooks rollback refused: playbook data exists';
  END IF;
END $guard$;
DROP TABLE public.playbooks RESTRICT;
COMMIT;
