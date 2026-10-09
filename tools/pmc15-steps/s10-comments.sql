DO $do$
BEGIN
  EXECUTE 'COMMENT ON TABLE public.person_roles IS ''Combination registry: customer/recruit/speaker/participant are derived from active business records by crm_person_roles_derive_v1 (origin=derived/legacy_backfill/manual provenance); partner/referrer/alumni/other are human-only tags. Business stage always comes from the owning business table''';
  EXECUTE 'COMMENT ON TABLE public.relationships IS ''Directed Person-to-Person edge. Only human-confirmed (status=confirmed) edges feed AI/search context; pending rows are candidates from AI or legacy notes awaiting confirmation. Family roles live in household_members and insurance roles in the policy/products domain''';
  EXECUTE 'COMMENT ON COLUMN public.relationships.source IS ''Where the edge came from: manual human entry, ai_suggested candidate, or legacy_note clue; provenance is retained after confirmation''';
  EXECUTE 'COMMENT ON COLUMN public.relationships.status IS ''pending = unconfirmed candidate (never auto-promoted); confirmed = human-confirmed fact with confirmed_at/confirmed_by_uid''';
  EXECUTE 'COMMENT ON TABLE public.households IS ''One optional lightweight family context per anchor Person; independent of relationships edges (neither is auto-generated from the other); not a policyholder/insured registry''';
END $do$;
