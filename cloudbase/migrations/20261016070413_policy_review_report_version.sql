-- PC13: preserve product edit version as report provenance. public schema only.
ALTER TABLE public.policy_review_reports
  ADD COLUMN input_products_version integer NULL
    CHECK (input_products_version IS NULL OR input_products_version > 0);

COMMENT ON COLUMN public.policy_review_reports.input_products_version IS
  'PC12 products.version captured when this report was generated; NULL for older reports or when no product row existed.';
