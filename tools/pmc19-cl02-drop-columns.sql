-- CL-02: DROP 7 base columns from customers (views rebuilt, function deployed, persons is authority)
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS customer_name,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS occupation,
  DROP COLUMN IF EXISTS education,
  DROP COLUMN IF EXISTS wx_account;
