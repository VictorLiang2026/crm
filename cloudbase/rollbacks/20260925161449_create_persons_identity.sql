-- Manual rollback only. Refuses to erase independent or changed person data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.customers IN SHARE MODE;
LOCK TABLE public.persons IN ACCESS EXCLUSIVE MODE;

DO $guard$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.customers AS c
    FULL JOIN public.persons AS p ON p.legacy_customer_id = c."Id"
    WHERE c."Id" IS NULL OR p.id IS NULL
       OR p.display_name IS DISTINCT FROM c.customer_name
       OR p.name_key IS DISTINCT FROM lower(regexp_replace(btrim(c.customer_name), '[[:space:]]+', ' ', 'g'))
       OR p.phone IS DISTINCT FROM c.phone
       OR p.wechat IS DISTINCT FROM c.wx_account
       OR p.gender IS DISTINCT FROM c.gender
       OR p.birthday IS DISTINCT FROM c.birthday
       OR p.occupation IS DISTINCT FROM c.occupation
       OR p.organization IS NOT NULL
       OR p.education IS DISTINCT FROM c.education
       OR p.source IS DISTINCT FROM c.source
       OR p.notes IS DISTINCT FROM c.additional_info
       OR p.created_at IS DISTINCT FROM c.created_at
       OR p.updated_at IS DISTINCT FROM coalesce(c.updated_at, c.created_at)
       OR p.deleted_at IS DISTINCT FROM c.deleted_at
  ) THEN
    RAISE EXCEPTION 'persons rollback refused: independent, missing or changed person records';
  END IF;
END $guard$;

DROP TABLE public.persons RESTRICT;
COMMIT;
