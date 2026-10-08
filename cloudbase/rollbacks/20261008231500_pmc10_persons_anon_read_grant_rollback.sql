-- PMC-10 rollback: revoke anon read access on public.persons (restore pre-migration state)
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS persons_anon_read ON public.persons;
REVOKE SELECT ON public.persons FROM anon;

COMMIT;
