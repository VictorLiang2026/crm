-- PMC-19 CL-03: Drop persons.legacy_customer_id column
-- Prerequisites: CL-04 (composite FK dropped), CL-08 (bridge trigger dropped)
-- All JS files and DB functions updated to use customers.person_id JOIN
ALTER TABLE public.persons DROP COLUMN IF EXISTS legacy_customer_id;
