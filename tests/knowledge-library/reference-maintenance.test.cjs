'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createCommunicationReferences,scoreReference}=require('../../cloudfunctions/assistant/communication-reference-service');
const {effectiveContent,projectContent}=require('../../cloudfunctions/_shared/knowledge-content');
const seeds=Array.from({length:156},(_,index)=>{
 const wording=index<72,number=String(wording?index+1:index-71).padStart(3,'0');
 return {title:'Synthetic topic '+index,kind:wording?'wording':'objection',content:'A wholly synthetic entry used to check the import workflow.',
  keywords:['topic'+index],origin:'fixture.docx',entryKey:(wording?'TALK-':'OBJ-')+number};
});
const expectedManualDigest=require('node:crypto').createHash('sha256').update(JSON.stringify(seeds,['content','entryKey','keywords','kind','origin','title'])).digest('hex');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');
const root=path.resolve(__dirname,'../..'),sql=name=>fs.readFileSync(path.join(root,'cloudbase/migrations',name),'utf8');
async function database(){
 const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
 for(const name of ['20260929230400_knowledge_items.sql','20260929234300_playbooks.sql','20261016150001_knowledge_governance.sql','20261016150002_knowledge_review_guards.sql'])await db.exec(sql(name));
 await db.exec(`ALTER TABLE public.knowledge_items ADD COLUMN source_id bigint,ADD COLUMN deleted_at timestamptz,ADD COLUMN content_state jsonb DEFAULT '{}',ADD COLUMN gpt_summary text,ADD COLUMN selected_content_source text DEFAULT 'original';
  ALTER TABLE public.playbooks ADD COLUMN deleted_at timestamptz,ADD COLUMN content_state jsonb DEFAULT '{}',ADD COLUMN gpt_summary text,ADD COLUMN selected_content_source text DEFAULT 'original';
  CREATE TABLE public.knowledge_sources(id bigint primary key,title text,created_by text,metadata jsonb DEFAULT '{}',sha256 text,version_no int,deleted_at timestamptz,lifecycle_status text,review_at date,valid_from date,valid_to date,published_at date,updated_at timestamptz);
  CREATE TABLE public.knowledge_documents(id bigint primary key,title text,original_name text,part_count int,page_count int,original_ready boolean,gpt_version int,gpt_summary text,gpt_basis text);
  GRANT SELECT ON public.knowledge_sources,public.knowledge_documents TO service_role;`);
 await db.exec(sql('20261117010000_knowledge_reference_maintenance.sql'));
 await db.exec('SET ROLE service_role');return db;
}
async function invoke(db,op,data,actor='staff'){
 return (await db.query('SELECT public.crm_knowledge_maintain_v1($1,$2,$3::jsonb) r',[op,actor,JSON.stringify(data)])).rows[0].r;
}
test('maintenance records default enabled, preserve versions, reject stale changes and restore content without reactivation',async()=>{
 const db=await database();try{
  const fields={table:'playbooks',title:'Budget concern',kind:'objection',content:'Clarify affordability. Do not pressure.',keywords:['预算']};
  let r=(await invoke(db,'saveReference',fields)).row;assert.equal(r.metadata.enabled,true);
  const id=r.id,oldStamp=r.updated_at;
  r=(await invoke(db,'saveReference',{...fields,id,expectedUpdatedAt:r.updated_at,content:'Respect a clear refusal.'})).row;
  await assert.rejects(invoke(db,'toggle',{table:'playbooks',id,enabled:false,expectedUpdatedAt:oldStamp}),/KNOWLEDGE_STALE/);
  r=(await invoke(db,'toggle',{table:'playbooks',id,enabled:false,expectedUpdatedAt:r.updated_at})).row;
  const history=await invoke(db,'history',{table:'playbooks',id});assert.equal(history.rows.length,3);
  const original=history.rows.at(-1);
  r=(await invoke(db,'restore',{table:'playbooks',id,historyId:original.id,expectedUpdatedAt:r.updated_at})).row;
  assert.equal(r.response_logic,fields.content);assert.equal(r.metadata.enabled,false);assert.equal(r.version_no,3);
  assert.equal(effectiveContent(r,'playbooks'),null);
  const k=await db.query(`INSERT INTO public.knowledge_items(item_type,source,content,verified,lifecycle_status,metadata) VALUES('evidence','Fixture','body',false,'draft','{}') RETURNING *`);
  const kr=k.rows[0];const switched=(await invoke(db,'toggle',{table:'knowledge_items',id:kr.id,expectedUpdatedAt:kr.updated_at,enabled:true})).row;
  assert.equal(switched.verified,false);assert.equal(switched.lifecycle_status,'draft');
  await assert.rejects(db.exec(sql('20261117010000_knowledge_reference_maintenance.rollback.sql')),/Export history/);
  await db.exec('ROLLBACK');
  for(const seed of seeds){const inserted=await invoke(db,'saveReference',{...seed,table:'playbooks'});assert.equal(inserted.row.metadata.enabled,true);}
  const repeated=await invoke(db,'saveReference',{...seeds[0],table:'playbooks'});assert.equal(repeated.skipped,true);
 }finally{await db.close();}
});
test('private history and maintenance reject anonymous access; migration rolls back cleanly when unused',async()=>{
 const db=await database();try{
  const privileges=(await db.query(`SELECT has_table_privilege('anon','public.knowledge_record_history','SELECT') read,has_function_privilege('authenticated','public.crm_knowledge_maintain_v1(text,text,jsonb)','EXECUTE') execute`)).rows[0];assert.deepEqual(privileges,{read:false,execute:false});
  await db.exec('RESET ROLE');await db.exec(sql('20261117010000_knowledge_reference_maintenance.rollback.sql'));
  assert.equal((await db.query("SELECT to_regclass('public.knowledge_record_history') t")).rows[0].t,null);
 }finally{await db.close();}
});
test('restoring an attached item cannot bind an old revision to changed source bytes',async()=>{
 const db=await database();try{
  await db.exec("RESET ROLE;INSERT INTO public.knowledge_sources(id,sha256,version_no,lifecycle_status) VALUES(9,'source-a',1,'verified');SET ROLE service_role;");
  const k=(await db.query("INSERT INTO public.knowledge_items(item_type,source,source_id,content,metadata) VALUES('evidence','Attached',9,'first','{}') RETURNING *")).rows[0];
  const history=await invoke(db,'history',{table:'knowledge_items',id:k.id});
  await db.exec("RESET ROLE;UPDATE public.knowledge_sources SET sha256='source-b',version_no=2 WHERE id=9;SET ROLE service_role;");
  await assert.rejects(invoke(db,'restore',{table:'knowledge_items',id:k.id,historyId:history.rows[0].id,expectedUpdatedAt:k.updated_at}),/KNOWLEDGE_SOURCE_CHANGED/);
 }finally{await db.close();}
});
test('all 156 synthetic entries are complete and are communication references rather than factual evidence',()=>{
 assert.equal(seeds.length,156);assert.equal(seeds.filter(x=>x.kind==='wording').length,72);
 assert.equal(seeds.filter(x=>x.kind==='objection').length,84);assert.equal(new Set(seeds.map(x=>x.entryKey)).size,156);
 for(const s of seeds){assert.ok(s.content.length>40&&s.content.length<=4000);assert.ok(s.origin.includes('.docx'));}
});
test('reference retrieval covers the end of the catalog, excludes disabled and unreviewed records, and returns no irrelevant fallback',async()=>{
 const rows=seeds.map((s,i)=>({id:i+1,scenario:s.title,response_logic:s.content,lifecycle_status:'verified',metadata:{usage:'communication_reference',keywords:s.keywords}}));
 rows[0].metadata.enabled=false;rows[1].lifecycle_status='draft';
 const svc=createCommunicationReferences({check:async()=>({status:'verified',containsTestData:false}),key:'fixture',request:async()=>[],rpc:async(_,{p_operation,p_data})=>({data:{ok:true,rows:rows.slice(p_data.offset,p_data.offset+p_data.limit+1),hasMore:rows.length>p_data.offset+p_data.limit,nextOffset:p_data.offset+p_data.limit}})});
 const found=await svc.candidates('staff',seeds.at(-1).title);assert.ok(found.some(x=>x.id===156));
 assert.deepEqual(await svc.candidates('staff','qzxvnonexistent'),[]);
 assert.equal(projectContent(rows[0],'playbooks'),null);
 assert.ok(scoreReference(rows[1],rows[1].scenario)>0);
});
test('manual import requires an actor-bound, expiring server preview and never overwrites existing entries',async()=>{
 let now=100,writes=0;const existing=seeds.map(s=>({metadata:{entryKey:s.entryKey}}));
 const svc=createCommunicationReferences({key:'fixture',expectedManualDigest,now:()=>now,request:async()=>[],rpc:async(_,{p_operation})=>{
  if(p_operation==='list')return {data:{ok:true,rows:existing,hasMore:false}};writes++;return {data:{ok:true}};
 }});
 await assert.rejects(svc.run('importPreview',{entries:[]},'staff'),/KNOWLEDGE_MANUAL_MISMATCH/);
 const preview=await svc.run('importPreview',{entries:seeds},'staff');
 assert.equal(preview.count,156);
 await assert.rejects(svc.run('importConfirm',{entries:seeds.slice(1),previewToken:preview.previewToken},'staff'),/KNOWLEDGE_MANUAL_MISMATCH/);
 await assert.rejects(svc.run('importConfirm',{entries:seeds,previewToken:preview.previewToken},'other'),/KNOWLEDGE_PREVIEW_EXPIRED/);
 const r=await svc.run('importConfirm',{entries:seeds,previewToken:preview.previewToken},'staff');assert.equal(r.skipped,156);assert.equal(writes,0);
 now+=600001;await assert.rejects(svc.run('importConfirm',{entries:seeds,previewToken:preview.previewToken},'staff'),/KNOWLEDGE_PREVIEW_EXPIRED/);
});
test('independent wording draft uses a fixed saved strategy, rechecks references, and never writes advice or customer data',async()=>{
 const basis={id:81,person_id:42,system_strategy:'Maintain the relationship; no product recommendation.',system_version:2,system_status:'ready'};
 const row={id:156,scenario:'保费太贵',response_logic:'先澄清是否预算不足。不得施压。',updated_at:'2026-11-16T00:00:00Z',version_no:1,lifecycle_status:'verified',metadata:{usage:'communication_reference',keywords:['预算'],enabled:true}};
 const calls=[],generations=[];let revoked=false;
 const fixture=()=>createKnowledgeLibrary({env:'crm-test123',key:'fixture',testDataReader:async()=>({status:'verified',containsTestData:false}),client:{callFunction:async()=>({})},
  fetchImpl:async(url,options={})=>{calls.push({url,method:options.method||'GET'});return {ok:true,text:async()=>JSON.stringify([basis])};},
  searchDataFactory:()=>({auditRdb:{rpc:async(name,args)=>{
   assert.equal(name,'crm_knowledge_maintain_v1');assert.equal(args.p_operation,'list');return {data:{ok:true,rows:[{...row,metadata:{...row.metadata,enabled:!revoked}}],hasMore:false}};
  }}}),gatewayFactory:()=>({runAITask:async input=>{generations.push(input);return {taskId:9,result:{message:'可以先聊聊你的顾虑，暂不讨论产品。'}};}})});
 const before=JSON.stringify(basis),service=fixture();
 const result=await service.run({operation:'communicationDraft',data:{adviceId:81,focus:'预算'}},'staff');
 assert.equal(result.strategyUnchanged,true);assert.equal(result.requiresHumanReview,true);assert.equal(JSON.stringify(basis),before);
 assert.ok(calls.every(x=>x.method==='GET'));assert.equal(generations[0].context.established_strategy,basis.system_strategy);
 assert.equal(generations[0].context.reference_entries.length,1);
 assert.ok(!JSON.stringify(generations[0]).includes(row.response_logic));
 assert.ok(!JSON.stringify(generations[0]).includes(row.scenario));
 revoked=true;const none=await service.run({operation:'communicationDraft',data:{adviceId:81,focus:'预算'}},'staff');assert.equal(none.status,'no_match');assert.equal(generations.length,1);
 const stale=createKnowledgeLibrary({env:'crm-test123',key:'fixture',testDataReader:async()=>({status:'verified',containsTestData:false}),client:{callFunction:async()=>({})},
  fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify([basis])}),
  searchDataFactory:()=>({auditRdb:{rpc:async()=>({data:{ok:true,rows:[row],hasMore:false}})}}),
  gatewayFactory:()=>({runAITask:async()=>{row.metadata.enabled=false;return {taskId:10,result:{message:'draft'}};}})});
 await assert.rejects(stale.run({operation:'communicationDraft',data:{adviceId:81,focus:'预算'}},'staff'),/STALE_SOURCE/);
});

test('private manuals cannot enter generic model prompts or the MCP record and generation routes',async()=>{
 const row={id:9,metadata:{usage:'communication_reference'},scenario:'Internal topic',response_logic:'Internal manual body',lifecycle_status:'verified'};
 assert.equal(projectContent(row,'playbooks'),null);
 const svc=createKnowledgeLibrary({env:'crm-test123',key:'fixture',client:{callFunction:async()=>{throw Error('unexpected call')}},fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify([{metadata:row.metadata}])})});
 for(const contentOperation of ['get','queueGpt','regenerate']){
  await assert.rejects(svc.run({operation:'content',contentOperation,data:{table:'playbooks',id:'9'}},'staff'),/RECORD_UNAVAILABLE/);
 }
});
