-- Revert only when linked person names and keys still match the migrated state.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;

DO $guard$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.persons AS p
    LEFT JOIN public.customers AS c ON c."Id" = p.legacy_customer_id
    WHERE p.legacy_customer_id IS NOT NULL
      AND (c."Id" IS NULL OR p.display_name IS DISTINCT FROM c.customer_name
       OR p.name_key IS DISTINCT FROM lower(regexp_replace(btrim(regexp_replace(
         translate(p.display_name, '　', ' '),
         '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
         '[[:space:]]+', ' ', 'g')))
  ) THEN
    RAISE EXCEPTION 'person name_key rollback refused: linked person names or keys changed';
  END IF;
END $guard$;

UPDATE public.persons AS p
SET name_key = lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g'))
WHERE p.legacy_customer_id IS NOT NULL
  AND p.name_key IS DISTINCT FROM lower(regexp_replace(btrim(p.display_name), '[[:space:]]+', ' ', 'g'));

COMMENT ON COLUMN public.persons.name_key IS 'Lowercase, whitespace-normalized search key; not unique';
COMMIT;
