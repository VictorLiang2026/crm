-- Run as role=service_role. The PL/pgSQL exception block rolls its synthetic rows back on success.
DO $test$
DECLARE
 r jsonb; p jsonb; q jsonb; command_id uuid; expected text:='90000000000490';
BEGIN
 BEGIN
 IF EXISTS(SELECT 1 FROM public.knowledge_items WHERE id=expected::bigint) THEN RAISE EXCEPTION 'SYNTHETIC_ID_IN_USE'; END IF;
 INSERT INTO public.knowledge_items(id,item_type,source,content,metadata,confidence,lifecycle_status,verified,verified_by,created_by,updated_by)
 VALUES(expected::bigint,'evidence','Generated review synthetic','Original system text','{"summary":"Original system summary"}',0.9,'verified',true,'generated-review-test','generated-review-test','generated-review-test');
 r=public.crm_knowledge_content_v1('get','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint));
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text','Generated candidate','summary','Generated summary')));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 command_id=(p->>'commandId')::uuid;
 IF r->>'status'<>'pending_review' OR (SELECT gpt_original_text FROM public.knowledge_items WHERE id=expected::bigint) IS NOT NULL THEN RAISE EXCEPTION 'PENDING_EDIT_WROTE_ACTIVE'; END IF;
 q=public.crm_knowledge_content_v1('get','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint));
 IF q#>>'{pending,commandId}'<>command_id::text THEN RAISE EXCEPTION 'PENDING_NOT_VISIBLE'; END IF;
 r=public.crm_knowledge_content_v1('approve','generated-review-test',jsonb_build_object('commandId',command_id));
 IF r#>>'{record,gpt,text}'<>'Generated candidate' OR r#>>'{record,gpt,reviewed}'<>'true' THEN RAISE EXCEPTION 'APPROVAL_FAILED'; END IF;
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','select','selected','gpt'));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','original','patch',jsonb_build_object('summary','Updated system summary')));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 r=public.crm_knowledge_content_v1('approve','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 IF r#>>'{record,original,reviewed}'<>'true' OR r#>>'{record,gpt,reviewed}'<>'false' OR r#>>'{record,paused}'<>'true' THEN RAISE EXCEPTION 'OTHER_PAIR_REVIEW_WAS_REUSED'; END IF;
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','select','selected','original'));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 p=public.crm_knowledge_content_v1('preview','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text',NULL)));
 r=public.crm_knowledge_content_v1('apply','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 IF (SELECT gpt_original_text FROM public.knowledge_items WHERE id=expected::bigint)<>'Generated candidate' THEN RAISE EXCEPTION 'PENDING_CLEAR_REMOVED_ACTIVE'; END IF;
 PERFORM public.crm_knowledge_content_v1('reject','generated-review-test',jsonb_build_object('commandId',p->>'commandId'));
 q=public.crm_knowledge_content_v1('get','generated-review-test',jsonb_build_object('table','knowledge_items','id',expected::bigint));
 IF q->'pending'<>'null'::jsonb OR q#>>'{record,gpt,text}'<>'Generated candidate' THEN RAISE EXCEPTION 'REJECT_FAILED'; END IF;
 RAISE EXCEPTION 'SYNTHETIC_ROLLBACK_PASS';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SYNTHETIC_ROLLBACK_PASS' THEN RAISE; END IF;
 END;
END; $test$;
