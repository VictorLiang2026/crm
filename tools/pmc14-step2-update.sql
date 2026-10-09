-- PMC-14 migration 20261009180000 step 2/2 (split for `tcb db execute` single-statement
-- channel). Single atomic UPDATE; per-row conditions guarantee idempotency and
-- unique-bridge resolution exactly as in the original migration file.
UPDATE public.activity_participants AS ap
SET canonical_person_id = p.id
FROM public.customers c
JOIN public.persons p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NOT NULL
  AND ap.person_type = 'customer'
  AND ap.person_id = c."Id"
  AND ap.canonical_person_id IS NULL
  AND c.deleted_at IS NULL
  AND (SELECT count(*) FROM public.persons x
       WHERE x.legacy_customer_id = c."Id" AND x.deleted_at IS NULL) = 1;
