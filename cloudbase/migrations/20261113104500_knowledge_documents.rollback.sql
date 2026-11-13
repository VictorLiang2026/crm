BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.knowledge_sources,public.knowledge_items,public.playbooks IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT FROM public.knowledge_documents WHERE original_ready OR gpt_summary IS NOT NULL) OR EXISTS(SELECT FROM public.knowledge_document_chunks) THEN
 RAISE EXCEPTION 'Export document originals, summaries and identifier mapping before destructive rollback'; END IF; END $$;
DROP TRIGGER knowledge_document_stamp ON public.playbooks;
DROP TRIGGER knowledge_document_stamp ON public.knowledge_items;
DROP TRIGGER knowledge_document_stamp ON public.knowledge_sources;
DROP INDEX public.knowledge_active_volume_slot;
UPDATE public.playbooks SET metadata=metadata-'document' WHERE metadata?'document';
UPDATE public.knowledge_items SET metadata=metadata-'document' WHERE metadata?'document';
UPDATE public.knowledge_sources SET metadata=metadata-'document' WHERE metadata?'document';
DROP FUNCTION public.crm_knowledge_document_stamp_v1() RESTRICT;
DROP FUNCTION public.crm_knowledge_document_read_v1(bigint) RESTRICT;
DROP TABLE public.knowledge_document_chunks RESTRICT;
DROP TABLE public.knowledge_documents RESTRICT;
COMMIT;
