SELECT to_jsonb(x) AS precheck FROM (
  SELECT
    (SELECT count(*) FROM public.person_roles) AS roles_total,
    (SELECT count(*) FROM public.relationships) AS relationships_total,
    (SELECT count(*) FROM public.households) AS households_total,
    (SELECT count(*) FROM public.household_members) AS household_members_total,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='relationships' AND column_name IN ('source','status','confirmed_at','confirmed_by_uid')) AS governance_cols,
    (SELECT to_regprocedure('public.crm_person_roles_derive_v1(bigint)') IS NOT NULL) AS derive_exists
) x;
