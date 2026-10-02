'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fresh, blockers, catalog } = require('./run.cjs');
const baseline = require('../security/expected-public-baseline.json');
const now = Date.now();
const date = new Date(now).toISOString();
const report = () => ({ version:1, environment:'crm-d1gkae8ddc930d151', fingerprint:'same',
  finishedAt:date, catalogObservedAt:date, checks:['catalog','regression','guard-tests','anonymous'].map(id => ({id,status:'PASS'})) });
test('gate accepts explicit gaps but never failure, missing critical check or stale evidence', () => {
  const r = report();
  r.checks.push({id:'login',status:'MANUAL_LOGIN'},{id:'service-runtime',status:'UNVERIFIED'});
  assert.deepEqual(blockers(r,'same',now),[]);
  for (const mutate of [
    r => { r.checks[0].status='FAIL'; },
    r => { r.checks[1].status='FAIL'; },
    r => { r.checks.pop(); },
    r => { r.checks.push({id:'login',status:'FAIL'}); },
    r => { r.fingerprint='older'; },
    r => { r.finishedAt='2000-01-01'; },
    r => { r.catalogObservedAt='2000-01-01'; },
    r => { r.environment='another'; },
    r => { r.checks[0].status='SKIP'; },
    r => { r.checks.push(r.checks[0]); }
  ]) { const bad=report(); mutate(bad); assert.ok(blockers(bad,'same',now).length); }
  assert.equal(fresh(new Date(now+120000).toISOString(),now),false);
});
test('fresh catalog detects expanded grants, view bypass and policy drift without rebaselining', () => {
  const actual = {...structuredClone(baseline), roles:require('./expected-roles.json'), environment:'crm-d1gkae8ddc930d151', version:'wp01-v1', observedAt:date};
  assert.deepEqual(catalog(actual,now).result.failures,[]);
  for(const change of [
    x => { x.roles.find(r=>r.name==='authenticated').bypass_rls=true; },
    x => { x.objects.find(o=>o.name==='persons').detail.privileges.anon=['SELECT']; },
    x => { x.objects.find(o=>o.name==='customers_view').detail.security_invoker=false; },
    x => { x.objects.find(o=>o.name==='customers').detail.policies[0].using_hash='changed'; }
  ]) {const bad=structuredClone(actual);change(bad);assert.ok(catalog(bad,now).result.failures.length);}
  assert.throws(()=>catalog({...actual,observedAt:'2000-01-01'},now),/expired/);
  assert.throws(()=>catalog({success:true,data:{truncated:true,returnedRows:1,rows:[{snapshot:actual}]}},now),/incomplete/);
});
test('interactive probe uses a fictional keyword and HEAD only, and never submits credentials', async () => {
  const source=fs.readFileSync(require.resolve('./login.cjs'),'utf8');
  const code=source.slice(source.indexOf('async function diagnostic('),source.indexOf('const html ='));
  const calls=[],requests=[];
  const marker='【系统测试·勿联系】crm_test_wp01_fixture';
  const token='header.'+Buffer.from(JSON.stringify({role:'authenticated',exp:Math.floor(now/1000)+600})).toString('base64url')+'.signature';
  const context=vm.createContext({
    initSdk:async()=>{}, authInst:{getSession:async()=>({data:{session:{access_token:token}}}),signOut:async()=>{}},
    document:{getElementById:()=>({textContent:''})}, Date, AbortSignal,
    atob:s=>Buffer.from(s,'base64').toString(),
    callFn:async(name,payload)=>{calls.push({name,payload});return {rows:[],total:0};},
    fetch:async(url,options)=>{requests.push({url,options});return {status:403,ok:true};}
  });
  vm.runInContext(code,context);
  await context.diagnostic(['customers','persons'],'nonce',marker);
  assert.deepEqual(calls.map(c=>({name:c.name,...c.payload})),[{name:'customers',action:'list',keyword:marker,page:1,pageSize:1}]);
  assert.equal(requests.filter(r=>r.options.method==='HEAD').length,2);
  const summary=requests.find(r=>r.url==='/result').options.body;
  assert.equal(summary.includes(token),false);
  assert.equal(summary.includes(marker),false);
  assert.equal(JSON.parse(summary).results.every(r=>r.status==='PASS'),true);
});
