-- Synthetic record only. Run as service_role in the isolated regression environment.
DO $test$
DECLARE r jsonb; p jsonb; q jsonb; command_id uuid; expected text:='90000000000490';
BEGIN
 BEGIN
 IF EXISTS(SELECT 1 FROM public.knowledge_items WHERE id=expected::bigint) THEN RAISE EXCEPTION 'SYNTHETIC_ID_IN_USE'; END IF;
 INSERT INTO public.knowledge_items(id,item_type,source,content,metadata,confidence,lifecycle_status,verified,verified_by,created_by,updated_by)
 VALUES(expected::bigint,'evidence','Generated review synthetic','Original system text','{"summary":"Original system summary"}',0.9,'verified',true,'generated-review-test','generated-review-test','generated-review-test');
 r=public.crm_knowledge_content_v1('get','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint));
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('summary','Generated summary'),'reviewed',false));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 command_id=(p->>'commandId')::uuid;
 IF r->>'status'<>'pending_review' OR (SELECT gpt_summary FROM public.knowledge_items WHERE id=expected::bigint) IS NOT NULL THEN RAISE EXCEPTION 'PENDING_EDIT_WROTE_ACTIVE'; END IF;
 q=public.crm_knowledge_content_v1('get','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint));
 IF q#>>'{pending,commandId}'<>command_id::text OR q#>>'{pending,after,gpt,summary}'<>'Generated summary' THEN RAISE EXCEPTION 'PENDING_NOT_VISIBLE'; END IF;
 r=public.crm_knowledge_content_v1('approve','generated-review-test',jsonb_build_object('commandId',command_id));
 IF r#>>'{record,gpt,summary}'<>'Generated summary' OR r#>>'{record,selected}'<>'original' THEN RAISE EXCEPTION 'APPROVAL_FAILED'; END IF;
 IF (SELECT gpt_summary FROM public.knowledge_items WHERE id=expected::bigint)<>'Generated summary' OR
    (SELECT content FROM public.knowledge_items WHERE id=expected::bigint)<>'Original system text' THEN RAISE EXCEPTION 'APPROVAL_CHANGED_SYSTEM_TEXT'; END IF;
 RAISE EXCEPTION 'SYNTHETIC_ROLLBACK_PASS';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='SYNTHETIC_ROLLBACK_PASS' THEN RAISE; END IF;
   RAISE;
 END;
END;
$test$;
