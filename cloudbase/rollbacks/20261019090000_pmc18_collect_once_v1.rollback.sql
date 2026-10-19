-- Roll back only after first reverting the already-live pmc18_observer caller.
-- This removes the RPC recorded by 20261019090000_pmc18_collect_once_v1.sql.
DROP FUNCTION IF EXISTS public.pmc18_collect_once_v1();

\n