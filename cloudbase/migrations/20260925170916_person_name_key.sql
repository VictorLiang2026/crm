-- Normalize only deterministic legacy person keys. No customers or pages change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;

DO $guard$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.persons AS p
    WHERE p.legacy_customer_id IS NOT NULL
      AND (p.name_key NOT IN (
        lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g')),
        lower(regexp_replace(btrim(regexp_replace(translate(p.display_name, '　', ' '),
          '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
          '[[:space:]]+', ' ', 'g'))
      ) OR btrim(p.display_name) = '')
  ) THEN
    RAISE EXCEPTION 'person name_key migration refused: unexpected existing key';
  END IF;
END $guard$;

WITH keys AS (
  SELECT p.id,
    lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g')) AS old_key,
    lower(regexp_replace(btrim(regexp_replace(translate(p.display_name, '　', ' '),
      '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
      '[[:space:]]+', ' ', 'g')) AS new_key
  FROM public.persons AS p
  WHERE p.legacy_customer_id IS NOT NULL
)
UPDATE public.persons AS p
SET name_key = keys.new_key
FROM keys
WHERE p.id = keys.id AND p.name_key = keys.old_key
  AND keys.old_key <> keys.new_key AND keys.new_key <> '';

DO $verify$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.persons AS p
    WHERE p.legacy_customer_id IS NOT NULL
      AND p.name_key IS DISTINCT FROM lower(regexp_replace(btrim(regexp_replace(
        translate(p.display_name, '　', ' '),
        '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
        '[[:space:]]+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'person name_key migration incomplete';
  END IF;
END $verify$;

COMMENT ON COLUMN public.persons.name_key IS
  'Lowercase, whitespace-normalized base name without trailing fullwidth/ASCII parenthesized qualifiers; not unique';
COMMIT;
