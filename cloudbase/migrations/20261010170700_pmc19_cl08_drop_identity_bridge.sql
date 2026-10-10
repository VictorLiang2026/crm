-- PMC-19 CL-08 (archived by PMC-20): retire the legacy customer -> Person projection
-- bridge. PersonService.updateBasicsWithProjection is the authoritative write path.
-- Executed 2026-10-10 from tools/pmc19-cl08-migration-trigger.sql and
-- tools/pmc19-cl08-migration-function.sql. No application code references the trigger.
DROP TRIGGER IF EXISTS customer_person_identity_bridge_trigger ON public.customers;
DROP FUNCTION IF EXISTS public.customer_person_identity_bridge();
