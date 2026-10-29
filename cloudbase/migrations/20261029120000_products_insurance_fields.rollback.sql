BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE NULLIF(btrim(current_policy_description), '') IS NOT NULL
       OR items IS NOT NULL AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(items::jsonb) AS item(value)
         WHERE COALESCE(item.value ->> 'total_premium', '') <> ''
            OR COALESCE(item.value ->> 'paid_premium', '') <> ''
       )
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: new policy descriptions or premium values would be lost';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE ap_ipa IS DISTINCT FROM trunc(ap_ipa)
       OR ap_ppa IS DISTINCT FROM trunc(ap_ppa)
       OR ap_ltc IS DISTINCT FROM trunc(ap_ltc)
       OR ap_ann IS DISTINCT FROM trunc(ap_ann)
       OR ap_life IS DISTINCT FROM trunc(ap_life)
       OR ap_term IS DISTINCT FROM trunc(ap_term)
       OR ap_wl IS DISTINCT FROM trunc(ap_wl)
       OR ap_pa IS DISTINCT FROM trunc(ap_pa)
       OR ap_ci IS DISTINCT FROM trunc(ap_ci)
       OR ap_hi IS DISTINCT FROM trunc(ap_hi)
       OR ap_all IS DISTINCT FROM trunc(ap_all)
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: fractional coverage amounts cannot be represented as bigint';
  END IF;
END $guard$;

DROP VIEW public.products_view;

UPDATE public.products p
SET items = (
  SELECT jsonb_agg(jsonb_build_object(
    'key', item.value ->> 'key',
    'label', COALESCE(item.value ->> 'label', item.value ->> 'key', ''),
    'amount', COALESCE(item.value ->> 'coverage_amount', ''),
    'premium', COALESCE(item.value ->> 'annual_premium', ''),
    'pay_years', '',
    'paid_years', '',
    'update_date', COALESCE(item.value ->> 'update_date', '')
  ) ORDER BY item.ordinality)::text
  FROM jsonb_array_elements(p.items::jsonb) WITH ORDINALITY AS item(value, ordinality)
)
WHERE p.items IS NOT NULL;

ALTER TABLE public.products
  ALTER COLUMN ap_ipa TYPE bigint USING ap_ipa::bigint,
  ALTER COLUMN ap_ppa TYPE bigint USING ap_ppa::bigint,
  ALTER COLUMN ap_ltc TYPE bigint USING ap_ltc::bigint,
  ALTER COLUMN ap_ann TYPE bigint USING ap_ann::bigint,
  ALTER COLUMN ap_life TYPE bigint USING ap_life::bigint,
  ALTER COLUMN ap_term TYPE bigint USING ap_term::bigint,
  ALTER COLUMN ap_wl TYPE bigint USING ap_wl::bigint,
  ALTER COLUMN ap_pa TYPE bigint USING ap_pa::bigint,
  ALTER COLUMN ap_ci TYPE bigint USING ap_ci::bigint,
  ALTER COLUMN ap_hi TYPE bigint USING ap_hi::bigint,
  ALTER COLUMN ap_all TYPE bigint USING ap_all::bigint,
  DROP COLUMN current_policy_description;

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
REVOKE ALL PRIVILEGES ON public.products_view FROM authenticated;

COMMIT;
