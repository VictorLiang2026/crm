'use strict';
// Offline synthetic records. Reject nonexistent recruit fields at query construction.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
function harness(name){
 const customer={Id:710001,customer_name:'[CRM_TEST_ONLY]增员甲',occupation:'工程师',recruitment_priority:'高',deleted_at:null};
 const recruit={id:720001,customer_id:customer.Id,stage:'初次面谈',deleted_at:null};
 const data={customers:[customer],recruit_candidates:[recruit],v_recruit_candidates:[{candidate_id:recruit.id,customer_id:customer.Id,customer_name:customer.customer_name,occupation:customer.occupation,stage:recruit.stage}],
 activities:[{id:730001,name:'[CRM_TEST_ONLY]活动',status:'ended',activity_date:'2026-09-20',deleted_at:null}],
 activity_participants:[{id:740001,activity_id:730001,person_type:'recruit',person_id:recruit.id,person_name:customer.customer_name,status:'attended',deleted_at:null}],
 activity_tasks:[{id:750001,activity_id:730001,task_title:'[CRM_TEST_ONLY]联系',related_type:'recruit',related_id:recruit.id,status:'pending',created_at:'2026-09-20'}],
 activity_speakers:[{id:760001,name:'[CRM_TEST_ONLY]嘉宾',recruit_candidate_id:recruit.id,customer_id:customer.Id,status:'active',deleted_at:null}],
 followups:[],recruit_followups:[],activity_topics:[],recruit_milestones:[],opportunities:[],ai_recommendations:[]};
 const invalid=[], prompts=[], writes=[];
 const rdb={from(table){if(!Object.hasOwn(data,table)||table.includes('.'))throw Error('Unexpected table '+table);let filters=[],single=false,cols;
 const validate=k=>{if(table==='recruit_candidates'&&['name','priority','occupation'].includes(k.trim())){invalid.push(k);throw Error('Nonexistent recruit_candidates.'+k);}
 if(table==='v_recruit_candidates'&&k.trim()==='deleted_at')throw Error('Nonexistent view.deleted_at');};
 let operation,payload;
 const q={select(c){cols=c;if(c&&c!=='*')c.split(',').forEach(validate);return q;},eq(k,v){validate(k);filters.push(r=>r[k]===v);return q;},neq(k,v){validate(k);filters.push(r=>r[k]!==v);return q;},in(k,vs){validate(k);filters.push(r=>vs.includes(r[k]));return q;},is(k,v){validate(k);filters.push(r=>r[k]==v);return q;},not(){return q;},order(){return q;},limit(){return q;},or(){return q;},gte(){return q;},lte(){return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
 let source=data[table];
 if(table==='v_recruit_candidates')source=source.filter(v=>data.recruit_candidates.some(r=>r.id===v.candidate_id&&!r.deleted_at)&&data.customers.some(c=>c.Id===v.customer_id&&!c.deleted_at));
 let rows=source.filter(r=>filters.every(f=>f(r)));
 if(operation){if(table!=='activity_participants')throw Error('Unexpected write');writes.push({operation,payload});if(operation==='insert'){rows=[{...payload,id:740002}];data[table].push(rows[0]);}else rows.forEach(r=>Object.assign(r,payload));}
 rows=structuredClone(rows);if(cols&&cols!=='*')rows=rows.map(r=>Object.fromEntries(cols.split(',').map(k=>[k.trim(),r[k.trim()]])));return {data:single?rows[0]||null:rows,error:null};}).then(resolve,reject);}};
 for(const method of ['insert','update'])q[method]=p=>{operation=method;payload=p;return q;};
 for(const method of ['delete','upsert'])q[method]=()=>{throw Error('Unexpected write '+table);};return q;}};
 const exports={};const db={rdb,assertOk:r=>{if(r.error)throw Error(r.error.message);return r;},normFields:(v,fields)=>Object.fromEntries(Object.entries(v).filter(([k])=>fields.includes(k))),nowIso:()=>new Date().toISOString(),generateText:async messages=>{prompts.push(JSON.stringify(messages));return {text:'{}'};},extractJson:()=>({})};
 const ctx=vm.createContext({exports,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,require:p=>{if(p!=='./db')throw Error(p);return db;}});
 const hooks=name==='activity_tasks'?'{enrichRelated}':name==='activities'?'{personTable}':name==='activity_speakers'?'{enrichIdentity}':'{loadActivityContext}';
 new vm.Script(fs.readFileSync(path.join(root,'cloudfunctions',name,'index.js'),'utf8')+'\nexports.hooks='+hooks).runInContext(ctx);
 return {exports,data,invalid,prompts,writes};
}
module.exports=async function suite(_root,test){
 const check=(id,fn)=>test('activity-schema.'+id,id,'real cloud function / strict synthetic schema',fn);
 await check('task-recruit-name',async()=>{const h=harness('activity_tasks');const r=await h.exports.main({action:'list',activity_id:730001});assert.ok(!r.error,r.error);assert.equal(r.rows[0].related_name,'[CRM_TEST_ONLY]增员甲');});
 await check('participant-search-id',async()=>{const h=harness('activities');const r=await h.exports.main({action:'searchPerson',person_type:'recruit',keyword:'增员甲'});assert.ok(!r.error,r.error);assert.equal(r.rows[0].id,720001);assert.equal(r.rows[0].name,'[CRM_TEST_ONLY]增员甲');assert.equal(r.rows[0].occupation,'工程师');});
 await check('prepare-context',async()=>{const h=harness('ai_activity');const r=await h.exports.hooks.loadActivityContext(730001);assert.equal(r.participants[0].name,'[CRM_TEST_ONLY]增员甲');assert.equal(r.participants[0].priority,'高');assert.equal(r.participants[0].occupation,'工程师');});
 for(const action of ['prepare','decompose','analyze','postReview','participantReview'])await check(action,async()=>{const h=harness('ai_activity');const r=await h.exports.main({action,activity_id:730001});assert.equal(h.invalid.length,0,'queried missing recruit columns');assert.ok(!r.error,r.error);assert.ok(h.prompts.length>0,'AI context was not reached');assert.ok(h.prompts.some(p=>p.includes('[CRM_TEST_ONLY]增员甲')));assert.equal(h.writes.length,0,'AI suggestions must remain read-only');if(action==='prepare'||action==='decompose'){assert.ok(Array.isArray(r.plan.suggested_tasks));assert.ok(h.prompts.some(p=>p.includes('优先级：高')));}});
 await check('speaker-recruit-link',async()=>{const h=harness('activity_speakers');const r=await h.exports.hooks.enrichIdentity(h.data.activity_speakers);assert.equal(r[0].linked_recruit.id,720001);assert.equal(r[0].linked_recruit.customer_id,710001);assert.equal(r[0].linked_recruit.name,'[CRM_TEST_ONLY]增员甲');});
 await check('participant-add',async()=>{const h=harness('activities');h.data.activity_participants=[];const r=await h.exports.main({action:'addParticipant',data:{activity_id:730001,person_type:'recruit',person_id:720001}});assert.ok(!r.error,r.error);assert.equal(r.linked,true);assert.equal(h.writes[0].payload.person_id,720001);assert.equal(h.writes[0].payload.person_name,'[CRM_TEST_ONLY]增员甲');});
 await check('participant-link',async()=>{const h=harness('activities');h.data.activity_participants[0].person_id=null;const r=await h.exports.main({action:'linkParticipant',id:740001,person_id:720001});assert.ok(r.ok,r.error);assert.equal(r.name,'[CRM_TEST_ONLY]增员甲');assert.equal(h.writes[0].payload.person_id,720001);});
 for(const table of ['customers','recruit_candidates'])await check('deleted-'+table,async()=>{const h=harness('ai_activity');h.data[table][0].deleted_at='2026-09-20';const r=await h.exports.hooks.loadActivityContext(730001);assert.equal(r.participants[0].name,'[CRM_TEST_ONLY]增员甲');assert.equal(r.participants[0].occupation,'');assert.equal(r.participants[0].priority,'');assert.equal(h.writes.length,0);const t=harness('activity_tasks');t.data[table][0].deleted_at='2026-09-20';const tasks=await t.exports.main({action:'list',activity_id:730001});assert.ok(!tasks.error,tasks.error);assert.equal(tasks.rows[0].related_name,null);});
 await check('unlinked-participant',async()=>{const h=harness('ai_activity');h.data.activity_participants[0].person_id=null;const r=await h.exports.hooks.loadActivityContext(730001);assert.equal(r.participants[0].linked,false);assert.equal(r.participants[0].priority,'');assert.equal(h.writes.length,0);});
 await check('missing-customer',async()=>{const h=harness('ai_activity');h.data.customers=[];const r=await h.exports.hooks.loadActivityContext(730001);assert.equal(r.participants[0].occupation,'');assert.equal(r.participants[0].priority,'');});
};
if(require.main===module){let failed=0;module.exports(root,async(id,title,layer,fn)=>{try{await fn();console.log('PASS '+id);}catch(e){failed++;console.log('FAIL '+id+': '+e.message);}}).then(()=>{process.exitCode=failed?1:0;});}
