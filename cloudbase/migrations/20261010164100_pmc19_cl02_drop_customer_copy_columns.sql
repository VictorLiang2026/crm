-- PMC-19 CL-02 (archived by PMC-20): drop the pmc18 basic-fields audit trigger/function
-- (column-level dependency that blocked the copy-column drop) and drop the 7 customer
-- copy columns. Executed 2026-10-10 from:
--   tools/pmc19-drop-pmc18-trigger.sql
--   tools/pmc19-drop-pmc18-fn.sql
--   tools/pmc19-cl02-drop-columns.sql
-- Prerequisites already executed: 11 views rebuilt (20261010164000), customers cloud
-- function deployed without these columns. No CASCADE used.
DROP TRIGGER IF EXISTS pmc18_customers_basics_audit ON public.customers;
DROP FUNCTION IF EXISTS public.pmc18_customers_basics_audit_fn();

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS customer_name,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS occupation,
  DROP COLUMN IF EXISTS education,
  DROP COLUMN IF EXISTS wx_account;
