'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..'),sql=name=>fs.readFileSync(path.join(root,'cloudbase/migrations',name),'utf8');
async function database(selector=true){
 const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
 for(const name of ['20260929230400_knowledge_items.sql','20260929234300_playbooks.sql','20261016150001_knowledge_governance.sql','20261016150002_knowledge_review_guards.sql'])await db.exec(sql(name));
 await db.exec(`ALTER TABLE public.knowledge_items ADD COLUMN source_id bigint,ADD COLUMN deleted_at timestamptz,ADD COLUMN content_state jsonb DEFAULT '{}',ADD COLUMN gpt_summary text,ADD COLUMN selected_content_source text DEFAULT 'original';
 ALTER TABLE public.playbooks ADD COLUMN deleted_at timestamptz,ADD COLUMN content_state jsonb DEFAULT '{}',ADD COLUMN gpt_summary text,ADD COLUMN selected_content_source text DEFAULT 'original';
 CREATE TABLE public.knowledge_sources(id bigint primary key,title text,created_by text,metadata jsonb DEFAULT '{}',sha256 text,version_no int,deleted_at timestamptz,lifecycle_status text,review_at date,valid_from date,valid_to date,published_at date,updated_at timestamptz);
 CREATE TABLE public.knowledge_documents(id bigint primary key,title text,original_name text,part_count int,page_count int,original_ready boolean,gpt_version int,gpt_summary text,gpt_basis text);
 GRANT SELECT ON public.knowledge_sources,public.knowledge_documents TO service_role;`);
 await db.exec(sql('20261117010000_knowledge_reference_maintenance.sql'));
 await db.exec(sql('20261117103000_private_docx_import.sql'));
 await db.exec(sql('20261118010000_reference_optimization.sql'));
 if(selector)await db.exec(sql('20261119003900_reference_version_selector.sql'));
 await db.exec('SET ROLE service_role');return db;
}
const invoke=async(db,op,data={},actor='staff')=>(await db.query('SELECT public.crm_reference_workflow_v1($1,$2,$3::jsonb) r',[op,actor,JSON.stringify(data)])).rows[0].r;
const seed=async(db,title='Synthetic wording')=>(await db.query('SELECT public.crm_knowledge_maintain_v1($1,$2,$3::jsonb) r',['saveReference','staff',JSON.stringify({title,content:'Respect a clear refusal.',table:'playbooks',kind:'wording',keywords:['budget']})])).rows[0].r.row;
async function candidate(db,id,lane='gpt',content='Ask permission before continuing.'){
 await invoke(db,'flags',{ids:[id],lane,enabled:true});
 const batch=await invoke(db,'start',{lane,requestId:randomUUID()});
 const job=(await invoke(db,'jobs',{batchId:batch.batchId})).rows[0];
 if(lane==='gpt')return {...await invoke(db,'gptSave',{jobId:job.id,title:'Synthetic wording',content,note:'Shorter and respectful.'}),job};
 const claimed=(await invoke(db,'claim')).job;
 return {...await invoke(db,'finish',{jobId:claimed.id,lease:claimed.lease,title:'Synthetic wording',content}),job};
}
test('two opt-in queues save independent candidates, preserve current content and adopt only a server preview',async()=>{
 const db=await database();try{
  const entry=await seed(db),initial=(await invoke(db,'versions',{id:entry.id}));
  assert.equal(initial.state.want_system,false);assert.equal(initial.state.want_gpt,false);
  await invoke(db,'flags',{ids:[entry.id],lane:'system',enabled:true});
  const g=await candidate(db,entry.id);let state=(await invoke(db,'versions',{id:entry.id})).state;
  assert.equal(state.current_id,initial.state.current_id);assert.equal(state.want_system,true);assert.equal(state.want_gpt,false);
  assert.equal((await invoke(db,'gptSave',{jobId:g.job.id})).duplicate,true);
  await assert.rejects(invoke(db,'gptSave',{jobId:g.job.id},'other'),/REFERENCE_DENIED/);
  const preview=await invoke(db,'adoptPreview');assert.equal(preview.rows.length,1);
  await assert.rejects(invoke(db,'adoptConfirm',{previewId:preview.previewId,ids:[99999]}),/REFERENCE_PREVIEW_REQUIRED/);
  assert.equal((await invoke(db,'adoptConfirm',{previewId:preview.previewId,ids:[g.versionId]})).adopted,1);
  assert.equal((await invoke(db,'adoptConfirm',{previewId:preview.previewId,ids:[g.versionId]})).adopted,1);
  const current=(await db.query('SELECT * FROM public.playbooks WHERE id=$1',[entry.id])).rows[0];assert.equal(current.response_logic,'Ask permission before continuing.');
  await assert.rejects(db.exec(sql('20261118010000_reference_optimization.rollback.sql')),/Export reference/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});

test('row selector remembers manual choice, explicitly adopts latest source and never follows future AI automatically',async()=>{
 const db=await database(true);try{
  const entry=await seed(db),base=(await invoke(db,'versions',{id:entry.id})).state.current_id;
  const state=async()=>(await invoke(db,'states',{id:entry.id})).rows[0];
  const pick=async mode=>{const s=await state(),v=s[mode==='current'?'manual_version':mode+'_version'];return invoke(db,'selectMode',{id:entry.id,mode,versionId:v.id,expectedCurrentId:s.current_id,expectedUpdatedAt:s.updated_at});};
  assert.equal((await state()).selection_mode,'current');assert.equal((await state()).manual_version_id,base);
  const g=await candidate(db,entry.id),sys=await candidate(db,entry.id,'system','A system response.');
  assert.equal((await pick('gpt')).row.response_logic,'Ask permission before continuing.');
  assert.equal((await state()).manual_version_id,base);
  await pick('system');assert.equal((await state()).current_id,sys.versionId);
  await pick('current');assert.equal((await state()).current_id,base);assert.equal((await state()).pinned,true);
  const edit=await invoke(db,'edit',{versionId:g.versionId,expectedCurrentId:base,title:entry.scenario,content:'Human revision.'});
  assert.equal((await state()).manual_version_id,edit.versionId);assert.equal((await state()).selection_mode,'current');
  await pick('gpt');const selected=(await state()).current_id;
  const newer=await candidate(db,entry.id,'gpt','A newer candidate.');
  assert.equal((await state()).current_id,selected);assert.equal((await state()).gpt_version.id,newer.versionId);
  assert.equal((await invoke(db,'adoptPreview')).rows.length,0);
  await pick('gpt');assert.equal((await state()).current_id,newer.versionId);
  await pick('current');assert.equal((await state()).current_id,edit.versionId);
  const before=(await db.query('SELECT version_no FROM public.playbooks WHERE id=$1',[entry.id])).rows[0].version_no;
  await pick('current');assert.equal((await db.query('SELECT version_no FROM public.playbooks WHERE id=$1',[entry.id])).rows[0].version_no,before);
 }finally{await db.close();}
});

test('selector rejects missing, foreign, stale and replaced targets atomically; legacy edits and rollback preserve content',async()=>{
 const db=await database(true);try{
  const a=await seed(db),b=await seed(db,'Other fixture');
  const state=async()=>(await invoke(db,'states',{id:a.id})).rows[0];let s=await state();
  const request=(mode,versionId)=>({id:a.id,mode,versionId,expectedCurrentId:s.current_id,expectedUpdatedAt:s.updated_at});
  await assert.rejects(invoke(db,'selectMode',request('gpt',s.current_id)),/REFERENCE_SELECTION_CHANGED/);
  const g=await candidate(db,a.id),foreign=await candidate(db,b.id);s=await state();
  await assert.rejects(invoke(db,'selectMode',request('gpt',foreign.versionId)),/REFERENCE_SELECTION_CHANGED/);
  const oldRequest=request('gpt',g.versionId);await candidate(db,a.id,'gpt','Another candidate.');
  s=await state();await assert.rejects(invoke(db,'selectMode',{...oldRequest,expectedUpdatedAt:s.updated_at}),/REFERENCE_SELECTION_CHANGED/);
  const valid=request('gpt',s.gpt_version.id);await invoke(db,'select',{versionId:s.current_id,expectedCurrentId:s.current_id,pin:true});
  await assert.rejects(invoke(db,'selectMode',valid),/REFERENCE_STALE/);
  s=await state();assert.equal(s.selection_mode,'current');assert.equal(s.current_id,s.manual_version_id);
  const record=(await db.query('SELECT * FROM public.playbooks WHERE id=$1',[a.id])).rows[0];
  await db.query("SELECT public.crm_knowledge_maintain_v1('saveReference','staff',$1::jsonb)",[JSON.stringify({table:'playbooks',id:a.id,expectedUpdatedAt:record.updated_at,title:record.scenario,content:'Legacy manual edit.',kind:'wording',keywords:[]})]);
  s=await state();assert.equal(s.current_id,s.manual_version_id);assert.equal(s.selection_mode,'current');assert.equal(s.pinned,true);
  await db.exec('RESET ROLE');await db.exec(sql('20261119003900_reference_version_selector.rollback.sql'));await db.exec('SET ROLE service_role');
  assert.equal((await db.query('SELECT response_logic FROM public.playbooks WHERE id=$1',[a.id])).rows[0].response_logic,'Legacy manual edit.');
  assert.ok((await invoke(db,'versions',{id:a.id})).rows.length>=4);
  await db.exec('RESET ROLE');await db.exec(sql('20261119003900_reference_version_selector.sql'));await db.exec('SET ROLE service_role');
  assert.equal((await state()).manual_version_id,s.manual_version_id);
  await db.exec('SET ROLE authenticated');await assert.rejects(invoke(db,'selectMode',valid),/permission denied/);
 }finally{await db.close();}
});
test('manual revisions branch without erasing history, pin excludes bulk adoption and stale preview fails atomically',async()=>{
 const db=await database();try{
  const entry=await seed(db),base=(await invoke(db,'versions',{id:entry.id})).state.current_id;
  const c=await candidate(db,entry.id),preview=await invoke(db,'adoptPreview');
  const edit=await invoke(db,'edit',{versionId:base,expectedCurrentId:base,title:entry.scenario,content:'A human correction.'});
  await assert.rejects(invoke(db,'adoptConfirm',{previewId:preview.previewId,ids:[c.versionId]}),/REFERENCE_STALE/);
  await invoke(db,'select',{versionId:base,expectedCurrentId:edit.versionId,pin:true});
  assert.equal((await invoke(db,'adoptPreview')).rows.length,0);
  await invoke(db,'select',{versionId:base,expectedCurrentId:base,latest:true,pin:false});
  const versions=await invoke(db,'versions',{id:entry.id});assert.equal(versions.rows.length,3);assert.equal(versions.state.current_id,edit.versionId);
 }finally{await db.close();}
});
test('batch manifest is fixed; worker leases, retry and revoking a flag cannot apply stale work',async()=>{
 const db=await database();try{
  const a=await seed(db),b=await seed(db,'Second synthetic');
  await invoke(db,'flags',{ids:[a.id],lane:'system',enabled:true});const requestId=randomUUID();
  assert.equal((await invoke(db,'start',{lane:'system',requestId})).selected,1);
  await invoke(db,'flags',{ids:[b.id],lane:'system',enabled:true});
  assert.equal((await invoke(db,'start',{lane:'system',requestId})).selected,1);
  let job=(await invoke(db,'claim')).job;
  await assert.rejects(invoke(db,'finish',{jobId:job.id,lease:randomUUID(),title:'Synthetic wording',content:'Text'}),/REFERENCE_LEASE/);
  await invoke(db,'fail',{jobId:job.id,lease:job.lease,error:'TIMEOUT'});
  assert.equal((await invoke(db,'versions',{id:a.id})).state.want_system,true);
  await invoke(db,'retry',{jobId:job.id});job=(await invoke(db,'claim')).job;assert.equal(job.attempts,2);
  await invoke(db,'flags',{ids:[a.id],lane:'system',enabled:false});
  await assert.rejects(invoke(db,'finish',{jobId:job.id,lease:job.lease,title:'Synthetic wording',content:'Text'}),/REFERENCE_CANCELLED/);
  await invoke(db,'flags',{ids:[a.id],lane:'gpt',enabled:true});
  const first=await invoke(db,'start',{lane:'gpt',requestId:randomUUID()});
  await invoke(db,'flags',{ids:[b.id],lane:'gpt',enabled:true});
  const resumed=await invoke(db,'start',{lane:'gpt',requestId:randomUUID()});
  assert.equal(resumed.selected,2);assert.equal((await invoke(db,'gptPackage',{batchId:resumed.batchId})).rows.length,2);
  assert.equal((await invoke(db,'gptPackage',{batchId:first.batchId})).rows.length,1);
 }finally{await db.close();}
});
test('document checkpoints remain actor scoped and failed parsing resumes the same stored source',async()=>{
 const db=await database();try{
  const source=(await db.query("SELECT public.crm_manual_import_v1('stage','staff',$1::jsonb) r",[JSON.stringify({filename:'fixture.docx',original:'eA==',sha256:'a'.repeat(64)})])).rows[0].r;
  let state=await invoke(db,'parseStart',{id:source.id});const id=state.job.id;
  assert.equal((await invoke(db,'parseStart',{id:source.id})).job.id,id);
  await assert.rejects(invoke(db,'parseStart',{id:source.id},'other'),/REFERENCE_DENIED/);
  let job=(await invoke(db,'claim')).job;
  await invoke(db,'parseProgress',{jobId:id,lease:job.lease,output:{cursor:10,lines:['synthetic']},done:false});
  job=(await invoke(db,'claim')).job;assert.equal(job.output.cursor,10);
  await invoke(db,'fail',{jobId:id,lease:job.lease,error:'TIMEOUT'});
  state=await invoke(db,'parseStart',{id:source.id,retry:true});assert.equal(state.job.output.cursor,10);assert.equal(state.job.status,'queued');
 }finally{await db.close();}
});
test('no-change optimization has no extra revision; private tables reject browser roles and unused rollback works',async()=>{
 const db=await database();try{
  const privilege=(await db.query("SELECT has_table_privilege('anon','public.crm_reference_versions','SELECT') r,has_function_privilege('authenticated','public.crm_reference_workflow_v1(text,text,jsonb)','EXECUTE') e")).rows[0];assert.deepEqual(privilege,{r:false,e:false});
  await db.exec('RESET ROLE');await db.exec(sql('20261118010000_reference_optimization.rollback.sql'));
  await db.exec(sql('20261118010000_reference_optimization.sql'));await db.exec('SET ROLE service_role');
  const a=await seed(db),r=await candidate(db,a.id,'system',a.response_logic);assert.equal(r.unchanged,true);
  assert.equal((await invoke(db,'versions',{id:a.id})).rows.length,1);
 }finally{await db.close();}
});
