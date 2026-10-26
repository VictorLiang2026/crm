'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('../../cloudfunctions/ai_activity/activity-prepare-v2');

test('activity preparation requires authenticated caller, uses Gateway, and returns advice without a business write',async()=>{
 const context={activity:{data:{id:21,status:'preparing'},source:{schema:'public',table:'activities',id:'21'}},participants:[],speakers:[],tasks:[]};
 const snapshot={...context,_context:{recipe:'activity_prepare',subjectType:'activity',subjectId:21}};
 const calls=[];
 const engine={buildContext:async input=>{calls.push(input);return {context,context_snapshot:snapshot}}};
 const gateway={runAITask:async input=>{calls.push(input);return {taskId:91,resultId:92,result:{brief:'Check venue',checklist:['Confirm room'],outreach:[],risks:[]}}}};
 assert.deepEqual(await run({activity_id:21,mode:'prepare'},{app:{auth:()=>({getUserInfo:()=>({uid:'',isAnonymous:true})})},engine,gateway}),{error:'UNAUTHORIZED'});
 const app={auth:()=>({getUserInfo:()=>({uid:'operator',isAnonymous:false})})};
 const result=await run({activity_id:21,mode:'decompose',language:'zh-CN'},{app,engine,gateway,rdb:{}});
 assert.equal(result.business_data_written,false);
 assert.equal(result.requires_confirmation,true);
 assert.equal(result.result_id,92);
 assert.deepEqual(calls[0],{recipe:'activity_prepare',subjectType:'activity',subjectId:21});
 assert.equal(calls[1].skill,'activity_prepare');
 assert.equal(calls[1].capability,'planning');
 assert.equal(calls[1].contextSnapshot,snapshot);
 assert.match(calls[1].input.objective,/简体中文/);
 assert.equal((await run({activity_id:21,mode:'bad',language:'en'},{app,engine,gateway,rdb:{}})).error,'INVALID_MODE');
 assert.equal((await run({activity_id:21,mode:'prepare',language:'bad'},{app,engine,gateway,rdb:{}})).error,'INVALID_LANGUAGE');
 context.activity.data.status='ended';
 assert.equal((await run({activity_id:21,mode:'prepare',language:'en'},{app,engine,gateway,rdb:{}})).error,'ACTIVITY_NOT_PREPARING');
 assert.equal(calls.filter(call=>call.skill).length,1);
});
