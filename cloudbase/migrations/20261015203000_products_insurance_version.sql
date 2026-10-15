-- PC12: serialize insurance edits and enforce one products row per customer.
-- This migration intentionally touches public only.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products WHERE customer_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PC12 stopped: public.products contains NULL customer_id values';
  END IF;
  IF EXISTS (
    SELECT customer_id FROM public.products GROUP BY customer_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PC12 stopped: public.products contains duplicate customer_id values';
  END IF;
END;
$$;

ALTER TABLE public.products
  ADD COLUMN version integer NOT NULL DEFAULT 1
    CHECK (version > 0);

ALTER TABLE public.products
  ADD CONSTRAINT products_customer_id_unique UNIQUE (customer_id);

COMMENT ON COLUMN public.products.version IS
  'Optimistic write version for PC12 Person insurance editor; incremented on each upsert.';
