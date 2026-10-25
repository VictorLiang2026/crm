'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateHistory,readAIHistory}=require('../../cloudfunctions/assistant/ai-history-query');
test('L03 validates source-specific date fields and sort direction before reading',async()=>{
 let calls=0;
 for(const filters of [{source:'runtime',dateField:'suggested_followup_date'},
  {source:'legacy',dateField:'created_at'},{dateField:'created_at,id.desc'},
  {source:'legacy',dateField:null},{sortDir:'desc,actor_uid'},{sortDir:null}]){
  await assert.rejects(readAIHistory(filters,{read:async()=>{calls++;return [];}}),e=>e.code==='INVALID_INPUT');
 }
 assert.equal(calls,0);assert.equal(Object.hasOwn(validateHistory({}),'dateField'),false);
 assert.equal(Object.hasOwn(validateHistory({}),'sortDir'),false);
});
test('L03 suggested date filters and stable sorting precede pagination; generated dates remain separate',async()=>{
 const calls=[];
 const records=[{id:13,recommendation_date:'2026-01-01',suggested_followup_date:'2026-10-25'},
  {id:12,recommendation_date:'2026-10-24',suggested_followup_date:null},
  {id:11,recommendation_date:'2026-10-23',suggested_followup_date:'2026-10-25'}];
 const read=async(table,f)=>{calls.push({table,f});return records;};
 const result=await readAIHistory({source:'legacy',dateField:'suggested_followup_date',sortDir:'asc',
  page:2,limit:2,startDate:'2026-10-25',endDate:'2026-10-31'},{read});
 const f=calls[0].f;
 assert.equal(f.order,'suggested_followup_date.asc.nullslast,id.asc');
 assert.equal(f.and,'(suggested_followup_date.gte.2026-10-25,suggested_followup_date.lte.2026-10-31)');
 assert.equal(f.offset,2);assert.equal(f.limit,3);assert.equal(result.pagination.hasMore,true);
 assert.equal(result.pagination.dateField,'suggested_followup_date');
 assert.equal(result.legacy[0].recommendation_date,'2026-01-01');
 assert.equal(result.legacy[0].source.id,'13');assert.equal(result.legacy[0].readOnly,true);
 await readAIHistory({source:'legacy'},{read});
 assert.equal(calls[1].f.order,'recommendation_date.desc.nullslast,id.desc');assert.equal(calls[1].f.and,undefined);
});
test('L03 runtime only orders its real created_at field and keeps Beijing end-date exclusivity',async()=>{
 let query;
 const result=await readAIHistory({source:'runtime',dateField:'created_at',sortDir:'asc',endDate:'2026-12-31'},
  {read:async(table,f)=>{query=f;return [];}});
 assert.equal(query.order,'created_at.asc,id.asc');
 assert.equal(query.and,'(created_at.lt.2027-01-01T00:00:00+08:00)');
 assert.equal(result.pagination.dateField,'created_at');
});
