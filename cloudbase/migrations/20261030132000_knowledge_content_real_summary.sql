BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.crm_knowledge_content_snapshot_v1(p_table text,p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE r jsonb; s jsonb; st jsonb; o jsonb; g jsonb; sig text; fp text; title text; managed boolean;
BEGIN
 IF current_user<>'service_role' OR p_table IS NULL OR p_table NOT IN ('knowledge_items','playbooks') OR p_id IS NULL OR p_id<=0 THEN RAISE EXCEPTION 'CONTENT_ACCESS_DENIED'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND deleted_at IS NULL',p_table) INTO r USING p_id;
 IF r IS NULL OR r->>'lifecycle_status'='superseded' THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
 IF p_table='knowledge_items' AND r->>'source_id' IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'sha256',sha256,'version_no',version_no,'lifecycle_status',lifecycle_status,'deleted_at',deleted_at,'review_at',review_at,'valid_from',valid_from,'valid_to',valid_to)
  INTO s FROM public.knowledge_sources WHERE id=(r->>'source_id')::bigint;
 END IF;
 o=jsonb_build_object('text',CASE WHEN p_table='playbooks' THEN r->>'response_logic' ELSE r->>'content' END,
  'summary',r#>>'{metadata,summary}','reviewed',true);
 sig=md5(coalesce(o->>'text','')||chr(31)||coalesce(o->>'summary',''));
 fp=CASE WHEN s IS NOT NULL THEN coalesce(s->>'sha256','')||':'||coalesce(s->>'version_no','') ELSE NULL END;
 st=coalesce(r->'content_state','{}'); managed=st ? 'original';
 IF managed AND st->>'baseSignature'=sig THEN o=st->'original'; END IF;
 g=jsonb_build_object('text',r->>'gpt_original_text','summary',r->>'gpt_summary','reviewed',coalesce((st#>>'{gpt,reviewed}')::boolean,false),
  'manualCleared',coalesce(st#>'{gpt,manualCleared}','[]'::jsonb),'provenance',coalesce(st#>>'{gpt,provenance}','manual_chatgpt'));
 IF managed AND ((s IS NOT NULL AND st->>'sourceFingerprint' IS DISTINCT FROM fp) OR
   (s IS NULL AND st->>'baseSignature' IS DISTINCT FROM sig)) THEN
   g=jsonb_set(g,'{reviewed}','false');
   IF s IS NOT NULL THEN o=jsonb_set(o,'{reviewed}','false'); END IF;
 END IF;
 title=CASE WHEN p_table='playbooks' THEN r->>'scenario' ELSE r->>'source' END;
 RETURN jsonb_build_object('table',p_table,'id',p_id,'title',title,'updatedAt',r->>'updated_at','original',o,'gpt',g,
  'selected',r->>'selected_content_source','paused',coalesce((st->>'paused')::boolean,false),'managed',managed,
  'baseSignature',sig,'sourceFingerprint',fp,'source',s,'lifecycleStatus',r->>'lifecycle_status',
  'version',coalesce((st->>'version')::int,0),'inputMode',CASE WHEN s IS NULL THEN 'recorded_text' ELSE 'attachment' END);
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_content_snapshot_v1(text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_content_snapshot_v1(text,bigint) TO service_role;

COMMIT;
