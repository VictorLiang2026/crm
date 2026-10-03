-- WP03 strengthened acceptance: public-only reads; no seed, RPC writes or IDs in output.
WITH tracked AS (
 SELECT * FROM public.crm_test_records WHERE batch_key='crm_test_main_v1'
), actual AS (
 SELECT 'persons' AS record_table, p.id::text AS record_id FROM public.persons p JOIN tracked r ON r.record_table='persons' AND r.record_id=p.id::text
 UNION ALL SELECT 'customers',p."Id"::text FROM public.customers p JOIN tracked r ON r.record_table='customers' AND r.record_id=p."Id"::text
 UNION ALL SELECT 'person_roles',p.id::text FROM public.person_roles p JOIN tracked r ON r.record_table='person_roles' AND r.record_id=p.id::text
 UNION ALL SELECT 'followups',p."Id"::text FROM public.followups p JOIN tracked r ON r.record_table='followups' AND r.record_id=p."Id"::text
 UNION ALL SELECT 'interactions',p.id::text FROM public.interactions p JOIN tracked r ON r.record_table='interactions' AND r.record_id=p.id::text
 UNION ALL SELECT 'opportunities',p.id::text FROM public.opportunities p JOIN tracked r ON r.record_table='opportunities' AND r.record_id=p.id::text
 UNION ALL SELECT 'actions',p.id::text FROM public.actions p JOIN tracked r ON r.record_table='actions' AND r.record_id=p.id::text
 UNION ALL SELECT 'activities',p.id::text FROM public.activities p JOIN tracked r ON r.record_table='activities' AND r.record_id=p.id::text
 UNION ALL SELECT 'activity_participants',p.id::text FROM public.activity_participants p JOIN tracked r ON r.record_table='activity_participants' AND r.record_id=p.id::text
 UNION ALL SELECT 'assistant_action_commands',p.id::text FROM public.assistant_action_commands p JOIN tracked r ON r.record_table='assistant_action_commands' AND r.record_id=p.id::text
 UNION ALL SELECT 'ai_tasks',p.id::text FROM public.ai_tasks p JOIN tracked r ON r.record_table='ai_tasks' AND r.record_id=p.id::text
 UNION ALL SELECT 'ai_runs',p.id::text FROM public.ai_runs p JOIN tracked r ON r.record_table='ai_runs' AND r.record_id=p.id::text
 UNION ALL SELECT 'ai_results',p.id::text FROM public.ai_results p JOIN tracked r ON r.record_table='ai_results' AND r.record_id=p.id::text
), identities AS (
 SELECT to_jsonb(p) AS row FROM public.persons p JOIN tracked r ON r.record_table='persons' AND r.record_id=p.id::text
 UNION ALL SELECT to_jsonb(p) FROM public.customers p JOIN tracked r ON r.record_table='customers' AND r.record_id=p."Id"::text
), checks AS (
 SELECT 'initial_global_cap' AS id,(SELECT count(*) FROM public.crm_test_records WHERE origin='initial')=10 AS passed
 UNION ALL SELECT 'initial_slots',count(*)=10 AND count(DISTINCT initial_slot)=10 AND min(initial_slot)=1 AND max(initial_slot)=10 FROM tracked WHERE origin='initial'
 UNION ALL SELECT 'all_tracked_rows_exist',NOT EXISTS(SELECT 1 FROM tracked r LEFT JOIN actual a USING(record_table,record_id) WHERE a.record_id IS NULL)
 UNION ALL SELECT 'parent_links',NOT EXISTS(SELECT 1 FROM tracked r LEFT JOIN tracked p ON p.record_table=r.parent_table AND p.record_id=r.parent_id WHERE r.origin<>'initial' AND p.record_id IS NULL)
 UNION ALL SELECT 'visible_registry_markers',count(*)>0 AND bool_and(position('【系统测试·勿联系】' IN visible_label)>0) FROM tracked
 UNION ALL SELECT 'no_identity_contacts',count(*)=2 AND bool_and(coalesce(row->>'phone','')='' AND coalesce(row->>'wechat','')='' AND coalesce(row->>'wx_account','')='') FROM identities
 UNION ALL SELECT 'ordinary_action_view',EXISTS(SELECT 1 FROM public.v_action_center WHERE person_name='【系统测试·勿联系】虚构体验甲')
 UNION ALL SELECT 'confirmed_replay_receipt',EXISTS(SELECT 1 FROM public.crm_test_previews WHERE batch_key='crm_test_main_v1' AND confirmed_at IS NOT NULL AND executed_at IS NOT NULL AND preview->>'initialNew'='0')
 UNION ALL SELECT 'ai_task_notice',EXISTS(SELECT 1 FROM public.ai_tasks t JOIN tracked r ON r.record_table='ai_tasks' AND r.record_id=t.id::text WHERE t.status='completed' AND t.context_snapshot#>>'{_testSearch,notice}'='含测试数据')
 UNION ALL SELECT 'ai_result_run_task_link',EXISTS(SELECT 1 FROM public.ai_results result JOIN tracked r ON r.record_table='ai_results' AND r.record_id=result.id::text JOIN public.ai_runs run ON run.id=result.run_id AND run.task_id=result.task_id JOIN public.ai_tasks task ON task.id=result.task_id WHERE run.success=true AND task.status='completed')
)
SELECT jsonb_build_object('observedAt',CURRENT_TIMESTAMP,'scope','public','checks',(SELECT jsonb_agg(jsonb_build_object('id',id,'passed',passed) ORDER BY id) FROM checks),'counts',(SELECT jsonb_object_agg(origin,n) FROM (SELECT origin,count(*) n FROM tracked GROUP BY origin) x)) AS acceptance;
