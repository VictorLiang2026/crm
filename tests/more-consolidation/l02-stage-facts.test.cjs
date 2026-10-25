'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {stageFacts,stageMessages,stageRule}=require('../../cloudfunctions/funnel_insight/stage-facts');
const rows=[
 {funnel:'customer',stage:'新认识',stage_order:1,kind:'active',current_count:20,overdue_count:0,entered_30d:3,stuck_count:null},
 {funnel:'customer',stage:'关系维护',stage_order:2,kind:'active',current_count:10,overdue_count:1,entered_30d:0},
 {funnel:'opportunity',stage:'成交',stage_order:4,kind:'terminal',current_count:0,dwell_median_days:40,stuck_count:0},
 {funnel:'recruit',stage:'新增人才',stage_order:1,kind:'active',current_count:3,moved_30d:2,dwell_median_days:0,stuck_count:0},
];
function service(){
 const exports={},modelCalls=[];
 const rdb={from:()=>({select:async()=>({data:rows})})};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/funnel_insight/index.js'),'utf8'),{
  exports,process:{env:{}},console,Date,setTimeout:()=>0,
  require(name){
   if(name==='./stage-facts')return{stageFacts,stageMessages,stageRule};
   if(name==='./db')return{rdb,generateText:async(messages)=>{modelCalls.push(messages);throw Error('Fixture AI failure');}};
   if(name==='./test-data')return{disclose:async()=>({status:'verified',containsTestData:false}),withMessages:m=>m};
   throw Error('unexpected dependency');
  },
 });return{main:exports.main,modelCalls};
}
test('L02 keeps default Legacy metrics while new facts preserve zero, null and terminal meaning',async()=>{
 const s=service(),old=await s.main({action:'stats'}),result=await s.main({action:'stats',presentation:'stage_facts'});
 assert.equal(old.funnels[0].rates[0].percent,50);
 assert.equal(old.funnels[0].stages[0].stuck,0);
 assert.equal(result.funnels[0].rates.length,0);
 assert.equal(result.funnels[0].stages[0].stuck,null);
 assert.equal(result.funnels[0].stages[0].overdue,0);
 assert.equal(result.funnels[1].stages[0].dwell_median_days,null);
 assert.equal(result.funnels[1].stages[0].overdue,null);
 assert.equal(result.funnels[2].stages[0].dwell_median_days,0);
 assert.equal(result.funnels[2].insufficient,true);
 assert.equal(s.modelCalls.length,0);
 assert.equal((await s.main({action:'stats',presentation:'bad'})).ok,false);
});
test('L02 AI gets no unverified rates, preserves restrictions and falls back to facts in both languages',async()=>{
 for(const language of ['zh-CN','en']){
  const s=service();const result=await s.main({action:'explain',presentation:'stage_facts',language});
  assert.equal(result.ok,true);assert.equal(result.source,'rule');
  const messages=s.modelCalls[0];assert.doesNotMatch(messages[1].content,/"percent"|相邻阶段转化率/);
  assert.match(messages[0].content,/不推断流转/);
  assert.match(result.text,language==='en'?/historical conversion/:/不代表历史转化率/);
 }
 const empty=stageFacts([{key:'customer',stages:[],rates:[],warnings:[]}],[]);
 assert.equal(empty[0].total,null);assert.match(stageRule(empty,'en'),/Overdue: unknown/);
});
