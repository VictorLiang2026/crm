BEGIN;

-- Make the new service-only directory RPC visible to the PostgreSQL REST layer.
NOTIFY pgrst, 'reload schema';

COMMIT;
