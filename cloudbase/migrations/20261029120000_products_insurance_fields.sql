BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF to_regclass('public.products_view') IS NULL THEN
    RAISE EXCEPTION 'public.products_view is missing; inspect the current schema before migrating';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE items IS NOT NULL AND CASE
      WHEN pg_input_is_valid(items, 'jsonb') THEN jsonb_typeof(items::jsonb) <> 'array'
      ELSE true
    END
  ) THEN
    RAISE EXCEPTION 'public.products contains invalid insurance items; inspect before migrating';
  END IF;
END $guard$;

-- The only dependent view is products_view. Recreate it after changing its amount column types.
DROP VIEW public.products_view;

ALTER TABLE public.products
  ADD COLUMN current_policy_description text,
  ALTER COLUMN ap_ipa TYPE numeric(21,2) USING ap_ipa::numeric(21,2),
  ALTER COLUMN ap_ppa TYPE numeric(21,2) USING ap_ppa::numeric(21,2),
  ALTER COLUMN ap_ltc TYPE numeric(21,2) USING ap_ltc::numeric(21,2),
  ALTER COLUMN ap_ann TYPE numeric(21,2) USING ap_ann::numeric(21,2),
  ALTER COLUMN ap_life TYPE numeric(21,2) USING ap_life::numeric(21,2),
  ALTER COLUMN ap_term TYPE numeric(21,2) USING ap_term::numeric(21,2),
  ALTER COLUMN ap_wl TYPE numeric(21,2) USING ap_wl::numeric(21,2),
  ALTER COLUMN ap_pa TYPE numeric(21,2) USING ap_pa::numeric(21,2),
  ALTER COLUMN ap_ci TYPE numeric(21,2) USING ap_ci::numeric(21,2),
  ALTER COLUMN ap_hi TYPE numeric(21,2) USING ap_hi::numeric(21,2),
  ALTER COLUMN ap_all TYPE numeric(21,2) USING ap_all::numeric(21,2);

UPDATE public.products p
SET items = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'key', item.value ->> 'key',
      'label', COALESCE(item.value ->> 'label', item.value ->> 'key', ''),
      'coverage_amount', COALESCE(
        CASE item.value ->> 'key'
          WHEN 'ap_ipa' THEN p.ap_ipa::text WHEN 'ap_ppa' THEN p.ap_ppa::text
          WHEN 'ap_ltc' THEN p.ap_ltc::text WHEN 'ap_ann' THEN p.ap_ann::text
          WHEN 'ap_life' THEN p.ap_life::text WHEN 'ap_term' THEN p.ap_term::text
          WHEN 'ap_wl' THEN p.ap_wl::text WHEN 'ap_pa' THEN p.ap_pa::text
          WHEN 'ap_ci' THEN p.ap_ci::text WHEN 'ap_hi' THEN p.ap_hi::text
          WHEN 'ap_all' THEN p.ap_all::text
        END, item.value ->> 'amount', ''),
      'total_premium', '',
      'paid_premium', '',
      'annual_premium', COALESCE(item.value ->> 'premium', ''),
      'update_date', COALESCE(item.value ->> 'update_date', '')
    ) ORDER BY item.ordinality
  )::text
  FROM jsonb_array_elements(p.items::jsonb) WITH ORDINALITY AS item(value, ordinality)
)
WHERE p.items IS NOT NULL;

CREATE VIEW public.products_view AS
 SELECT pr.id,
    pr.created_at,
    pr.customer_id,
    pr.customer_name,
    pr.ap_ipa,
    pr.ap_ltc,
    pr.ap_ann,
    pr.ap_life,
    pr.ap_term,
    pr.ap_wl,
    pr.ap_pa,
    pr.ap_ci,
    pr.ap_hi,
    pr.ap_all,
    p.gender,
    p.occupation,
    c.tags,
    p.customer_stage,
    p.source,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal,
    g.gift_name,
    g.quantity AS gift_quantity,
    g.given_date,
    g.notes AS gift_notes
   FROM public.products pr
     LEFT JOIN public.customers c ON pr.customer_id = c."Id"
     LEFT JOIN public.persons p ON p.id = c.person_id AND p.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT followups."Id", followups.followup_notes, followups.followup_date,
              followups.next_followup_date, followups.next_followup_goal,
              followups.customer_id, followups.created_at
       FROM public.followups
       WHERE followups.customer_id = pr.customer_id
       ORDER BY followups.created_at DESC
       LIMIT 1
     ) f ON true
     LEFT JOIN LATERAL (
       SELECT ai_recommendations.id, ai_recommendations.recommendation_date,
              ai_recommendations.suggested_followup_date, ai_recommendations.suggested_message,
              ai_recommendations.suggested_strategy, ai_recommendations.suggested_customer_stage,
              ai_recommendations.suggested_followup_goal, ai_recommendations.customer_id
       FROM public.ai_recommendations
       WHERE ai_recommendations.customer_id = pr.customer_id
       ORDER BY ai_recommendations.created_at DESC
       LIMIT 1
     ) a ON true
     LEFT JOIN LATERAL (
       SELECT gifts."Id", gifts.gift_name, gifts.quantity, gifts.notes,
              gifts.given_date, gifts.customer_id, gifts.created_at
       FROM public.gifts
       WHERE gifts.customer_id = pr.customer_id
       ORDER BY gifts.created_at DESC
       LIMIT 1
     ) g ON true;

ALTER VIEW public.products_view SET (security_invoker = true);
ALTER VIEW public.products_view OWNER TO cloudbase_postgres_pgdb_pn3idppt;
GRANT SELECT ON public.products_view TO anon;
GRANT ALL PRIVILEGES ON public.products_view TO service_role, cloudbase_postgres_pgdb_pn3idppt;

COMMIT;
