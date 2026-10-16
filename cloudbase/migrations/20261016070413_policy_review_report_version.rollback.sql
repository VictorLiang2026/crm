-- PC13 rollback: removes only the optional product-version provenance field.
ALTER TABLE public.policy_review_reports
  DROP COLUMN input_products_version;