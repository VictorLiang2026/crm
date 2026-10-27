'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

test('Person summary keeps source provenance inside Gateway metadata and preserves its response', async () => {
  const file = path.resolve(__dirname, '../../cloudfunctions/assistant/summarize-service.js');
  const loaded = new Module(file);
  loaded.filename = file;
  let request;
  const stubs = {
    './db': { app: {} },
    './ai-gateway': { createAIGateway: () => ({ runAITask: async value => {
      request = value;
      await value.onStarted?.({taskId:91,runId:93});
      return { taskId: 91, resultId: 92, skillVersion: '1.0.0',
        result: { summary: '【系统测试·勿联系】虚构摘要', signals: [], gaps: [], nextActions: [], evidence: [] } };
    } }) },
    './search-data': { createSearchData: () => ({ auditRdb: {} }) },
  };
  loaded.require = id => {
    if (!(id in stubs)) throw Error(`Unexpected import: ${id}`);
    return stubs[id];
  };
  loaded._compile(fs.readFileSync(file, 'utf8'), file);
  const previousFetch = global.fetch;
  const previousEnv = { env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY };
  process.env.TCB_ENV = 'crm-test123';
  process.env.CRM_ASSISTANT_DB_API_KEY = 'fictional-test-key';
  global.fetch = async url => {
    const table = new URL(url).pathname.split('/').pop();
    const rows = table === 'persons' ? [{ id: 783, display_name: '【系统测试·勿联系】虚构体验甲' }] : [];
    return { ok: true, text: async () => JSON.stringify(rows) };
  };
  try {
  let started;
  const result = await loaded.exports.runSummarize({ personId: '783' }, {onStarted:value=>{started=value;}});
    const { _context, ...snapshotData } = request.contextSnapshot;
    assert.deepEqual(snapshotData, request.context);
    assert.deepEqual(_context.sources, result.sources);
    assert.equal(_context.sources[0].table, 'persons');
    assert.equal(result.taskId, 91);
    assert.deepEqual(started,{taskId:91,runId:93});
    assert.equal(typeof request.onStarted,'function');
    assert.equal(result.resultId, 92);
    assert.equal(result.execution.businessDataWritten, false);
  } finally {
    global.fetch = previousFetch;
    if (previousEnv.env === undefined) delete process.env.TCB_ENV;
    else process.env.TCB_ENV = previousEnv.env;
    if (previousEnv.key === undefined) delete process.env.CRM_ASSISTANT_DB_API_KEY;
    else process.env.CRM_ASSISTANT_DB_API_KEY = previousEnv.key;
  }
});

test('summary task status returns the audited result without rereading the Person',async()=>{
  const file=path.resolve(__dirname,'../../cloudfunctions/assistant/summarize-service.js');
  const loaded=new Module(file);loaded.filename=file;
  loaded.require=id=>id==='./db'?{app:{}}:id==='./ai-gateway'?{createAIGateway:()=>({})}:
    id==='./search-data'?{createSearchData:()=>({auditRdb:{}})}:(()=>{throw Error(`Unexpected import ${id}`)})();
  loaded._compile(fs.readFileSync(file,'utf8'),file);
  const previousFetch=global.fetch,previousEnv={env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY};
  process.env.TCB_ENV='crm-test123';process.env.CRM_ASSISTANT_DB_API_KEY='fictional-test-key';
  const requests=[];
  global.fetch=async url=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').pop();requests.push({table,filters:Object.fromEntries(parsed.searchParams)});
    const row=table==='ai_tasks'?[{id:'91',task_type:'person_summary',status:'completed',subject_type:'person',subject_id:'783',
      context_snapshot:{_context:{version:'1.0.0',sources:[{schema:'public',table:'persons',id:'783',label:'Synthetic'}]},_skill:{version:'1.0.0'}}}]:
      [{id:'92',task_id:'91',rank:1,result_json:{summary:'summary',signals:['signal'],gaps:[],nextActions:['next'],evidence:[]}}];
    return {ok:true,text:async()=>JSON.stringify(row)};
  };
  try{
    const result=await loaded.exports.getSummaryTaskStatus({taskId:'91',personId:'783'});
    assert.equal(result.status,'completed');assert.equal(result.summary,'summary');assert.equal(result.resultId,'92');
    assert.deepEqual(result.sources,[{schema:'public',table:'persons',id:'783',label:'Synthetic'}]);
    assert.deepEqual(requests.map(row=>row.table),['ai_tasks','ai_results']);
    assert.equal(requests[0].filters['id'],'eq.91');
  }finally{
    global.fetch=previousFetch;
    if(previousEnv.env===undefined)delete process.env.TCB_ENV;else process.env.TCB_ENV=previousEnv.env;
    if(previousEnv.key===undefined)delete process.env.CRM_ASSISTANT_DB_API_KEY;else process.env.CRM_ASSISTANT_DB_API_KEY=previousEnv.key;
  }
});
