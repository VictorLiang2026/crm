-- PMC-14 dry-run: exact row set the step-2 UPDATE would match, evaluated in the
-- SAME channel as the UPDATE (tcb db execute). Expect 7 if channel visibility is OK.
SELECT count(*) AS would_match
FROM public.activity_participants ap
JOIN public.customers c ON c."Id" = ap.person_id AND c.deleted_at IS NULL
JOIN public.persons p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NOT NULL
  AND ap.person_type = 'customer'
  AND ap.person_id IS NOT NULL
  AND ap.canonical_person_id IS NULL
  AND (SELECT count(*) FROM public.persons x
       WHERE x.legacy_customer_id = c."Id" AND x.deleted_at IS NULL) = 1;
