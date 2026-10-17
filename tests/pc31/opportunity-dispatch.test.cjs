'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let uid = 'fictional-pc31';
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === '@cloudbase/node-sdk') return {init:() => ({auth:() => ({getUserInfo:() => ({uid})})})};
  return originalLoad.call(this, name, ...args);
};
let main;
try { ({main} = require('../../cloudfunctions/person_360')); }
finally { Module._load = originalLoad; }

test('PC31 opportunity entry projects business filters and retains validation and runtime identity binding', async () => {
  const originalFetch = global.fetch;
  const env = process.env.TCB_ENV, key = process.env.CRM_PERSON360_DB_API_KEY;
  const calls = [];
  process.env.TCB_ENV = 'crm-test'; process.env.CRM_PERSON360_DB_API_KEY = 'fictional-key';
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/v1/rdb/rest/rpc/crm_opportunity_directory_v1');
    assert.equal(options.headers['Accept-Profile'], 'public');
    calls.push(JSON.parse(options.body));
    return {ok:true,json:async () => ({rows:[],page:2,total:0,hasMore:false})};
  };
  try {
    const result = await main({action:'listOpportunityDirectory',page:2,pageSize:20,kind:'person',status:'active'});
    assert.deepEqual(result,{rows:[],page:2,total:0,hasMore:false});
    assert.deepEqual(calls,[{p_actor_uid:'fictional-pc31',p_page:2,p_page_size:20,p_kind:'person',
      p_status:'active',p_type:null,p_person_id:null,p_query:null}]);
    await main({action:'listOpportunityDirectory',page:2,pageSize:20,kind:'person',status:'active',
      actorUid:'spoof',userInfo:{uid:'spoof'},__clientInfo:{source:'fictional SDK envelope'}});
    assert.deepEqual(calls[1],calls[0], 'envelope and caller identity claims cannot affect business query or actor');
    assert.match((await main({action:'listOpportunityDirectory',pageSize:51})).error,/Invalid/);
    uid = '';
    assert.deepEqual(await main({action:'listOpportunityDirectory'}),{error:'UNAUTHORIZED'});
    assert.equal(calls.length,2);
  } finally {
    uid = 'fictional-pc31'; global.fetch = originalFetch;
    for (const [name,value] of [['TCB_ENV',env],['CRM_PERSON360_DB_API_KEY',key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
