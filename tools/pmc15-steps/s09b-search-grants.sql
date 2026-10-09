DO $do$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.crm_search_people_v1(text,integer,integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.crm_search_people_v1(text,integer,integer) TO service_role';
  EXECUTE 'COMMENT ON FUNCTION public.crm_search_people_v1(text,integer,integer) IS ''Read-only, fixed-template Person search. Results and evidence are computed only from public CRM records; relationship templates use human-confirmed edges only''';
END $do$;
