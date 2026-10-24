'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateHistory,readAIHistory}=require('../../cloudfunctions/assistant/ai-history-query');
const {runAiExperience}=require('../../cloudfunctions/assistant/ai-experience-service');
const {createAiExperienceData}=require('../../cloudfunctions/assistant/ai-experience-data');
const {aiExperienceInput,createMain}=require('../../cloudfunctions/assistant');
const {getPersonAIHistory}=require('../../cloudfunctions/assistant/person-ai-history-service');

test('M12 rejects injected filters, invalid calendar/range, unsafe IDs and unbounded pagination before reading',async()=>{
 let calls=0;
 for(const filters of [null,[],{actorUid:'forged'},{source:'all'},{page:0},{page:'2'},{page:10001},{limit:51},
  {personId:'1,2'},{personId:9007199254740992},{personId:'9223372036854775808'},{type:'x,subject_id.eq.2'},
  {startDate:'2026-02-30'},{startDate:'2026-12-01',endDate:'2026-01-01'},
  {source:'legacy',type:'person_summary'},{endDate:'9999-12-31'}]){
   await assert.rejects(readAIHistory(filters,{read:async()=>{calls++;return [];}}),e=>e.code==='INVALID_INPUT');
 }
 assert.equal(calls,0);assert.equal(validateHistory({personId:'9223372036854775807'}).personId,'9223372036854775807');
});

test('M12 runtime applies Person/type/date on server before task paging, scopes related rows and preserves actors',async()=>{
 const calls=[];
 const read=async(table,f)=>{calls.push({table,f});
  if(table==='persons')return [{id:71}];
  if(table==='ai_tasks')return [{id:141},{id:142},{id:143}];
  if(table==='ai_results')return [{id:241,task_id:141},{id:242,task_id:142}];
  if(table==='ai_result_feedback_events')return [{id:'fixture-event',ai_result_id:241,actor_uid:'fixture-human',decision:'accepted'}];
  if(table==='outcomes')return [{id:341,ai_result_id:241,recorded_by_uid:'fixture-human'}];
  return [];};
 const result=await readAIHistory({source:'runtime',page:71,limit:2,personId:'71',type:'meeting_prep',
  startDate:'2026-10-01',endDate:'2026-10-24'},{read});
 const f=calls.find(c=>c.table==='ai_tasks').f;
 assert.equal(f.offset,140);assert.equal(f.limit,3);assert.equal(f.subject_type,'eq.person');assert.equal(f.subject_id,'eq.71');
 assert.equal(f.task_type,'eq.meeting_prep');assert.equal(f.order,'created_at.desc,id.desc');
 assert.equal(f.and,'(created_at.gte.2026-10-01T00:00:00+08:00,created_at.lt.2026-10-25T00:00:00+08:00)');
 assert.equal(calls.find(c=>c.table==='ai_results').f.task_id,'in.(141,142)');
 assert.equal(calls.find(c=>c.table==='ai_result_feedback_events').f.ai_result_id,'in.(241,242)');
 assert.equal(result.pagination.hasMore,true);assert.equal(result.pagination.total,null);assert.equal(result.pagination.unit,'task');
 assert.equal(result.decisions[0].actor_uid,'fixture-human');assert.equal(result.outcomes[0].recorded_by_uid,'fixture-human');
 assert.deepEqual(result.legacy,[]);assert.equal(calls.some(c=>c.table==='ai_recommendations'),false);
});

test('M12 legacy source has independent filters, IDs and readonly rows with no ai_results feedback query',async()=>{
 const calls=[];const read=async(table,f)=>{calls.push({table,f});
  if(table==='persons')return [{id:71}];if(table==='customers')return [{Id:301},{Id:302}];
  if(table==='ai_recommendations')return [{id:241,customer_id:301,nba:{status:'completed'}}];
  throw Error('unexpected '+table);};
 const result=await readAIHistory({source:'legacy',page:51,limit:3,personId:71,type:'约见面',startDate:'2026-10-01',endDate:'2026-10-24'},{read});
 const f=calls.at(-1).f;assert.equal(f.customer_id,'in.(301,302)');assert.equal(f.offset,150);assert.equal(f.limit,4);
 assert.equal(f.suggested_followup_goal,'eq.约见面');assert.equal(f.and,'(recommendation_date.gte.2026-10-01,recommendation_date.lte.2026-10-24)');
 assert.equal(result.legacy[0].source.table,'ai_recommendations');assert.equal(result.legacy[0].readOnly,true);
 assert.deepEqual(result.results,[]);assert.equal(result.pagination.hasMore,false);assert.equal(result.pagination.total,null);
 assert.equal(result.metrics,null);assert.equal(calls.length,3);
 const none=await readAIHistory({source:'legacy',personId:71},{read:async table=>table==='persons'?[{id:71}]:[]});
 assert.deepEqual(none.legacy,[]);
});

test('M12 missing Person, malformed backend responses and related truncation are explicit',async()=>{
 let reads=0;
 await assert.rejects(readAIHistory({personId:71},{read:async()=>{reads++;return [];}}),e=>e.code==='NOT_FOUND');assert.equal(reads,1);
 await assert.rejects(readAIHistory({},{read:async()=>null}),e=>e.code==='PERSISTENCE_ERROR');
 const result=await readAIHistory({},{read:async table=>{
  if(table==='ai_tasks')return [{id:1}];
  const cap=table==='ai_result_feedback_events'?500:200;
  return Array.from({length:cap+1},(_,i)=>({id:i+1,task_id:1}));
 }});
 assert.equal(result.results.length,200);assert.equal(result.decisions.length,500);
 assert.deepEqual(result.pagination.relatedTruncated,{results:true,decisions:true,outcomes:true,learnings:true});
});

test('M12 optional contracts preserve old list and transport projection; writes reject read filters and forged actor',async()=>{
 const calls=[];const data={list:async()=>{calls.push('old');return {results:[]};},history:async f=>{calls.push(f);return {source:f.source};}};
 await runAiExperience({action:'aiExperience',operation:'list'},'actual-actor',{data});
 const projected=aiExperienceInput({action:'aiExperience',operation:'list',filters:{source:'legacy'},requestId:'transport'});
 assert.deepEqual(projected,{action:'aiExperience',operation:'list',filters:{source:'legacy'}});
 assert.equal((await runAiExperience(projected,'actual-actor',{data})).source,'legacy');assert.equal(calls[0],'old');
 assert.equal(aiExperienceInput({...projected,actorUid:'forged'}),null);
 assert.equal(aiExperienceInput({action:'aiExperience',operation:'decide',filters:{}}),null);
 await assert.rejects(runAiExperience({...projected,filters:{actorUid:'forged'}},'actual-actor',{data}));
 const anonymous=createMain(async()=>({uid:'anonymous',isAnonymous:true}));
 assert.equal((await anonymous(projected)).error.code,'UNAUTHORIZED');
 const read=async table=>table==='persons'?[{id:71}]:[];
 assert.deepEqual(await getPersonAIHistory({personId:71},{read}),{ok:true,generated:[],legacy:[]});
 const paged=await getPersonAIHistory({personId:71,filters:{source:'legacy'}},{read});assert.equal(paged.format,'paged-v1');
 await assert.rejects(getPersonAIHistory({personId:71,filters:{personId:72}},{read}),e=>e.code==='INVALID_INPUT');
});

test('M12 REST adapter only reads public, keeps credentials server-side, and labels metrics as unfiltered',async()=>{
 const calls=[];const data=createAiExperienceData({env:'crm-testfictional',key:'fixture-only',fetchImpl:async(url,init)=>{
  calls.push({url:new URL(url),init});return new Response(JSON.stringify(String(url).includes('/rpc/')?{windowDays:30}:[]),{status:200});
 }});
 const runtime=await data.history({source:'runtime'});assert.deepEqual(runtime.metricsScope,{windowDays:30,filtered:false});
 const legacy=await data.history({source:'legacy'});assert.equal(legacy.metrics,null);
 assert.equal(calls.length,3);
 for(const {init} of calls){assert.equal(init.headers['Accept-Profile'],'public');assert.equal(init.headers.Authorization,'Bearer fixture-only');}
 assert.equal(calls[0].init.method,'GET');assert.equal(calls[2].init.method,'GET');
 assert.equal(calls[1].url.pathname.endsWith('/rpc/crm_ai_experience_metrics_v1'),true);
});
