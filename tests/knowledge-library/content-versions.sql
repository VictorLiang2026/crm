-- Synthetic records only. No sequence increments; all writes roll back.
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.knowledge_items(id,item_type,source,content,metadata,confidence,lifecycle_status,verified,verified_by,created_by,updated_by)
VALUES(90000000000312,'evidence','KCV synthetic - do not use','System text','{"summary":"System summary"}',0.9,'verified',true,'kcv-test','kcv-test','kcv-test'),
(90000000000313,'evidence','KCV no summary - do not use','System text','{}',0.9,'verified',true,'kcv-test','kcv-test','kcv-test');
INSERT INTO public.playbooks(id,scenario,objection,response_logic,next_objective,source,confidence,lifecycle_status,verified_by,created_by,updated_by)
VALUES(90000000000314,'KCV synthetic','Test objection','Existing response','Confirm','Synthetic',0.9,'verified','kcv-test','kcv-test','kcv-test');
DO $test$
DECLARE r jsonb; p jsonb; q jsonb; h text; e text; n int;
BEGIN
 r=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000312}');
 IF r#>>'{record,selected}'<>'original' THEN RAISE EXCEPTION 'FAIL default'; END IF;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text','Manual GPT','summary','Manual summary'),'reviewed',true));
 IF (SELECT gpt_original_text FROM public.knowledge_items WHERE id=90000000000312) IS NOT NULL THEN RAISE EXCEPTION 'FAIL preview wrote'; END IF;
 BEGIN PERFORM public.crm_knowledge_content_v1('apply','other-actor',jsonb_build_object('commandId',p->>'commandId'));RAISE EXCEPTION 'FAIL actor';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_NOT_FOUND' THEN RAISE;END IF; END;
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 h=p->>'commandId';
 IF r->>'status'<>'pending_review' OR (SELECT gpt_original_text FROM public.knowledge_items WHERE id=90000000000312) IS NOT NULL THEN RAISE EXCEPTION 'FAIL pending save'; END IF;
 q=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000312}');
 IF q#>>'{pending,commandId}'<>h OR q#>>'{record,gpt,text}' IS NOT NULL THEN RAISE EXCEPTION 'FAIL pending visibility'; END IF;
 r=public.crm_knowledge_content_v1('approve','kcv-test',jsonb_build_object('commandId',h));
 IF r#>>'{record,gpt,text}'<>'Manual GPT' OR r#>>'{record,selected}'<>'original' OR r#>>'{record,gpt,reviewed}'<>'true' THEN RAISE EXCEPTION 'FAIL approval'; END IF;
 q=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 IF q->>'reused'<>'true' THEN RAISE EXCEPTION 'FAIL idempotence'; END IF;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','select','selected','gpt'));
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 IF r#>>'{record,selected}'<>'gpt' THEN RAISE EXCEPTION 'FAIL select'; END IF;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text',NULL)));
 q=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','select','selected','original'));
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 h=p->>'commandId';
 IF r->>'status'<>'pending_review' OR (SELECT gpt_original_text FROM public.knowledge_items WHERE id=90000000000312)<>'Manual GPT' THEN RAISE EXCEPTION 'FAIL active preserved'; END IF;
 BEGIN PERFORM public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',q->>'commandId'));RAISE EXCEPTION 'FAIL pending guard';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_PENDING_EXISTS' THEN RAISE;END IF; END;
 r=public.crm_knowledge_content_v1('approve','kcv-test',jsonb_build_object('commandId',h));
 IF r#>>'{record,gpt,text}' IS NOT NULL OR r#>>'{record,gpt,summary}'<>'Manual summary' OR r#>>'{record,paused}'<>'true' THEN RAISE EXCEPTION 'FAIL clear'; END IF;
 BEGIN PERFORM public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',q->>'commandId'));RAISE EXCEPTION 'FAIL stale';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_STALE' THEN RAISE;END IF; END;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','restore','historyId',h));
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 r=public.crm_knowledge_content_v1('approve','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 IF r#>>'{record,gpt,text}'<>'Manual GPT' THEN RAISE EXCEPTION 'FAIL restore'; END IF;
 p=public.crm_knowledge_content_v1('regenerate','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','part','summary'));
 q=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000312}');
 IF q#>>'{job,commandId}'<>p->>'commandId' THEN RAISE EXCEPTION 'FAIL resume'; END IF;
 p=public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000312,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','original','patch',jsonb_build_object('text',NULL,'summary',NULL)));
 r=public.crm_knowledge_content_v1('apply','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 r=public.crm_knowledge_content_v1('approve','kcv-test',jsonb_build_object('commandId',p->>'commandId'));
 IF r#>>'{record,original,text}' IS NOT NULL OR r#>>'{record,original,summary}' IS NOT NULL THEN RAISE EXCEPTION 'FAIL system clear'; END IF;
 IF (SELECT content FROM public.knowledge_items WHERE id=90000000000312)<>'System text' THEN RAISE EXCEPTION 'FAIL legacy preservation'; END IF;
 IF r#>>'{record,gpt,text}'<>'Manual GPT' THEN RAISE EXCEPTION 'FAIL independent pair'; END IF;
 r=public.crm_knowledge_content_v1('get','kcv-test','{"table":"knowledge_items","id":90000000000313}');
 BEGIN PERFORM public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','knowledge_items','id',90000000000313,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text','Must reject')));RAISE EXCEPTION 'FAIL missing system summary';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_SYSTEM_PAIR_REQUIRED' THEN RAISE;END IF; END;
 r=public.crm_knowledge_content_v1('get','kcv-test','{"table":"playbooks","id":90000000000314}');
 IF r#>>'{record,original,summary}' IS NOT NULL THEN RAISE EXCEPTION 'FAIL response is not summary'; END IF;
 BEGIN PERFORM public.crm_knowledge_content_v1('preview','kcv-test',jsonb_build_object('table','playbooks','id',90000000000314,
  'expectedUpdatedAt',r#>>'{record,updatedAt}','action','edit','target','gpt','patch',jsonb_build_object('text','Must reject')));RAISE EXCEPTION 'FAIL playbook missing summary';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_SYSTEM_PAIR_REQUIRED' THEN RAISE;END IF; END;
END; $test$;
ROLLBACK;
