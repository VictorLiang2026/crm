-- Read-only post-migration verification; scoped to public business objects.
SELECT
  (SELECT count(*) FROM public.customers) AS customer_count,
  (SELECT count(*) FROM public.persons) AS person_count,
  (SELECT count(*) FROM public.persons WHERE legacy_customer_id IS NOT NULL) AS linked_person_count,
  (SELECT count(*) FROM public.customers AS c
     LEFT JOIN public.persons AS p ON p.legacy_customer_id = c."Id"
     WHERE p.id IS NULL) AS missing_customer_links,
  (SELECT count(*) FROM public.persons AS p
     LEFT JOIN public.customers AS c ON c."Id" = p.legacy_customer_id
     WHERE p.legacy_customer_id IS NOT NULL AND c."Id" IS NULL) AS orphan_links,
  (SELECT count(*) FROM public.persons AS p
     JOIN public.customers AS c ON c."Id" = p.legacy_customer_id
     WHERE p.display_name IS DISTINCT FROM c.customer_name
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
        OR p.deleted_at IS DISTINCT FROM c.deleted_at) AS mapping_mismatches,
  (SELECT count(*) FROM public.persons WHERE deleted_at IS NOT NULL) AS deleted_person_count,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.persons'::regclass) AS rls_enabled,
  has_table_privilege('anon', 'public.persons', 'SELECT') AS anon_can_select,
  has_table_privilege('authenticated', 'public.persons', 'SELECT') AS authenticated_can_select,
  has_table_privilege('service_role', 'public.persons', 'SELECT') AS service_role_can_select;
