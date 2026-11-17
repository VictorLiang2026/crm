BEGIN;
SET LOCAL lock_timeout='5s';
-- Keep new history and enabled metadata when data exists. Rollback must not reactivate disabled records.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.knowledge_record_history) OR
  EXISTS(SELECT 1 FROM public.knowledge_items WHERE metadata ? 'enabled') OR
  EXISTS(SELECT 1 FROM public.playbooks WHERE metadata ? 'enabled' OR metadata->>'usage'='communication_reference') THEN
  RAISE EXCEPTION 'Export history and retain enabled filtering before rollback; content data requires explicit assessment';
 END IF;
END $guard$;
DROP TRIGGER knowledge_history ON public.knowledge_items;
DROP TRIGGER knowledge_history ON public.playbooks;
DROP FUNCTION public.crm_knowledge_history_stamp_v1();
DROP FUNCTION public.crm_knowledge_maintain_v1(text,text,jsonb);
DROP TABLE public.knowledge_record_history;
CREATE OR REPLACE FUNCTION public.crm_knowledge_document_read_v1(p_document bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH eligible AS (
  SELECT i.id,i.source_id,s.metadata->'document' AS info,i.metadata->>'summary' AS summary,i.content,
   md5(concat_ws('|',i.updated_at,s.updated_at,i.content,i.metadata->>'summary',i.content_state::text)) AS revision,
   row_number() OVER(PARTITION BY s.id ORDER BY i.version_no DESC,i.updated_at DESC,i.id DESC) AS rank
  FROM public.knowledge_sources s JOIN public.knowledge_items i ON i.source_id=s.id
  WHERE s.metadata#>>'{document,number}'=p_document::text AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    AND i.verified AND i.lifecycle_status='verified' AND s.lifecycle_status='verified'
    AND coalesce(s.review_at,current_date)>=current_date AND coalesce(s.valid_from,current_date)<=current_date
    AND coalesce(s.valid_to,current_date)>=current_date AND coalesce(i.valid_from,current_date)<=current_date
    AND coalesce(i.valid_to,current_date)>=current_date AND NOT coalesce((i.content_state->>'paused')::boolean,false)
    AND nullif(btrim(i.metadata->>'summary'),'') IS NOT NULL AND nullif(btrim(i.content),'') IS NOT NULL
    AND (NOT (i.content_state?'original') OR (coalesce((i.content_state#>>'{original,reviewed}')::boolean,false)
     AND i.content_state->>'sourceFingerprint'=concat(s.sha256,':',s.version_no)
     AND i.content_state->>'baseSignature'=md5(i.content||chr(31)||(i.metadata->>'summary'))))
 ), coverage AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',id,'sourceId',source_id,'part',info->'part','start',info->'start','end',info->'end',
    'summary',summary) ORDER BY (info->>'part')::int,id),'[]') AS parts,
    md5(coalesce(string_agg(id::text||':'||revision,',' ORDER BY (info->>'part')::int,id),'')) AS basis
  FROM eligible WHERE rank=1
 )
 SELECT jsonb_build_object('id',d.id,'title',d.title,'name',d.original_name,'parts',c.parts,'total',d.part_count,'pages',d.page_count,
  'originalReady',d.original_ready,'gptVersion',d.gpt_version,'basis',c.basis,'gpt',CASE WHEN d.gpt_basis=c.basis AND c.parts<>'[]'::jsonb THEN d.gpt_summary END,
  'needsReview',d.gpt_summary IS NOT NULL AND d.gpt_basis IS DISTINCT FROM c.basis)
 FROM public.knowledge_documents d CROSS JOIN coverage c WHERE d.id=p_document AND d.part_count IS NOT NULL
$fn$;

COMMIT;
