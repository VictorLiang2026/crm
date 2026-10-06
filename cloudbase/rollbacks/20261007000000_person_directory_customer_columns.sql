-- Rollback: restore person_directory_page_v1 to original version (no customer columns).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.person_directory_page_v1(
  p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_keyword text DEFAULT '',
  p_sort_field text DEFAULT 'id',p_sort_dir text DEFAULT 'desc')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $directory$
DECLARE v_total bigint; v_pages integer; v_rows jsonb; v_order text;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page<1 OR p_page>100000 OR p_page_size IS NULL
     OR p_page_size<1 OR p_page_size>50 OR length(coalesce(p_keyword,''))>40
     OR p_sort_field NOT IN ('id','display_name','updated_at')
     OR p_sort_dir NOT IN ('asc','desc') THEN RAISE EXCEPTION 'Invalid directory request'; END IF;
  SELECT count(*) INTO v_total FROM public.persons p WHERE p.deleted_at IS NULL
    AND (btrim(p_keyword)='' OR position(lower(btrim(p_keyword)) in lower(p.display_name))>0);
  v_pages:=greatest(1,ceil(v_total::numeric/p_page_size)::integer);
  v_order:=format('p.%I %s NULLS LAST, p.id %s',p_sort_field,upper(p_sort_dir),upper(p_sort_dir));
  EXECUTE format($sql$SELECT coalesce(jsonb_agg(to_jsonb(t)-'_ordinal' ORDER BY t._ordinal),'[]'::jsonb) FROM (
    SELECT row_number() OVER (ORDER BY %s) AS _ordinal,
      p.id,p.display_name,p.occupation,p.organization,p.updated_at,
      p.legacy_customer_id AS customer_id,
      (SELECT coalesce(jsonb_agg(pr.role ORDER BY pr.role),'[]'::jsonb)
         FROM public.person_roles pr WHERE pr.person_id=p.id) AS roles,
      (SELECT rc.id FROM public.recruit_candidates rc
         WHERE rc.person_id=p.id AND rc.deleted_at IS NULL ORDER BY rc.id LIMIT 1) AS recruit_id
    FROM public.persons p WHERE p.deleted_at IS NULL
      AND (btrim($1)='' OR position(lower(btrim($1)) in lower(p.display_name))>0)
    ORDER BY %s LIMIT $2 OFFSET $3) t$sql$,v_order,v_order)
    INTO v_rows USING p_keyword,p_page_size,(p_page-1)*p_page_size;
  RETURN jsonb_build_object('rows',v_rows,'page',p_page,'pageSize',p_page_size,
    'total',v_total,'totalPages',v_pages,'hasMore',p_page<v_pages,
    'sortField',p_sort_field,'sortDir',p_sort_dir);
END $directory$;
REVOKE ALL ON FUNCTION public.person_directory_page_v1(integer,integer,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_directory_page_v1(integer,integer,text,text,text) TO service_role;
COMMIT;
