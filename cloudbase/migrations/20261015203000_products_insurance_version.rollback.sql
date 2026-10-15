-- PC12 rollback. Insurance values are not changed or removed.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_customer_id_unique;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS version;
