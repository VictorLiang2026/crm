-- Read-only live verification of the name-key migration; no person names exposed.
WITH keyed AS (
  SELECT p.id, p.display_name, p.name_key, p.legacy_customer_id,
    lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g')) AS prior_key,
    lower(regexp_replace(btrim(regexp_replace(translate(p.display_name, '　', ' '),
      '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
      '[[:space:]]+', ' ', 'g')) AS expected_key
  FROM public.persons AS p
)
SELECT
  count(*) AS person_count,
  count(*) FILTER (WHERE name_key <> prior_key) AS converted_keys,
  count(*) FILTER (WHERE name_key IS DISTINCT FROM expected_key) AS mismatched_keys,
  count(*) FILTER (WHERE expected_key = '') AS empty_keys,
  count(*) FILTER (WHERE legacy_customer_id IS NULL) AS independent_people,
  (SELECT count(*) FROM (SELECT expected_key FROM keyed GROUP BY expected_key HAVING count(*) > 1) groups)
    AS duplicate_key_groups
FROM keyed;
