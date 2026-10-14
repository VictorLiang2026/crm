BEGIN;

-- Reconcile the PostgreSQL REST schema cache after filtered Person directory RPC calls returned HTTP 404.
NOTIFY pgrst, 'reload schema';

COMMIT;
