-- Synthetic records only. All writes are rolled back.
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.knowledge_items(id,item_type,source,content,metadata,confidence,lifecycle_status,verified,verified_by,created_by,updated_by)
VALUES(90000000000312,'evidence','KCV synthetic - do not use','System text','{"summary":"System summary"}',0.9,'verified',true,'kcv-test','kcv-test','kcv-test');
DO $test$
DECLARE r jsonb; p jsonb; q jsonb; command_id uuid;
BEGIN
 r=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000312}');
 IF r#>>'{record,selected}'<>'original' THEN RAISE EXCEPTION 'FAIL default'; END IF;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('summary','GPT summary candidate'),'reviewed',false));
 IF (SELECT gpt_summary FROM public.knowledge_items WHERE id=90000000000312) IS NOT NULL THEN RAISE EXCEPTION 'FAIL preview wrote'; END IF;
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 command_id=(p->>'commandId')::uuid;
 IF r->>'status'<>'pending_review' OR (SELECT gpt_summary FROM public.knowledge_items WHERE id=90000000000312) IS NOT NULL THEN RAISE EXCEPTION 'FAIL pending save'; END IF;
 q=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000312}');
 IF q#>>'{pending,commandId}'<>command_id::text OR q#>>'{record,gpt,text}' IS NOT NULL THEN RAISE EXCEPTION 'FAIL summary-only pending'; END IF;
 r=public.crm_knowledge_content_v1('approve','kcv-test',jsonb_build_object('commandId',command_id));
 IF r#>>'{record,gpt,summary}'<>'GPT summary candidate' OR r#>>'{record,selected}'<>'original' THEN RAISE EXCEPTION 'FAIL approval'; END IF;
 IF (SELECT content FROM public.knowledge_items WHERE id=90000000000312)<>'System text' THEN RAISE EXCEPTION 'FAIL system original changed'; END IF;
 BEGIN
  PERFORM public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','action','select','selected','gpt'));
  RAISE EXCEPTION 'FAIL GPT source selection allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_INVALID_INPUT' THEN RAISE; END IF; END;
END;
$test$;
ROLLBACK;
