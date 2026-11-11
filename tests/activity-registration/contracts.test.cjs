'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('registration migration is public-only, service-role-only and guarded on rollback',()=>{
  const sql=read('cloudbase/migrations/20261110110000_activity_registration.sql');
  const rollback=read('cloudbase/migrations/20261110110000_activity_registration.rollback.sql');
  for(const table of ['activity_registration_pages','activity_registration_submissions','activity_registration_people','activity_registration_audit']){
    assert.match(sql,new RegExp(`CREATE TABLE public\\.${table}\\b`));
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
    assert.match(sql,new RegExp(`CREATE POLICY ${table}_service_only ON public\\.${table}`));
  }
  assert.match(sql,/REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT ALL[\s\S]*TO service_role/);
  assert.doesNotMatch(sql,/\bpr\./i);
  assert.match(rollback,/activity registration data exists/);
  assert.doesNotMatch(rollback,/DROP TABLE public\.[\s\S]*CASCADE/i);
});

test('public API uses a server-side hashed management token and keeps applicant actions narrow',()=>{
  const source=read('cloudfunctions/activity_registration/index.js');
  assert.match(source,/const PUBLIC_ACTIONS = new Set\(\['getPublishedPage', 'submit', 'getMyRegistration', 'updateMyRegistration'\]\)/);
  assert.match(source,/exports\.main = event => dispatch\(event, false\)/);
  assert.match(source,/exports\.publicMain = event => dispatch\(event, true\)/);
  assert.match(source,/crypto\.randomBytes\(32\)/);
  assert.match(source,/createHash\('sha256'\)/);
  assert.match(source,/CRM_ACTIVITY_REGISTRATION_DB_API_KEY/);
  assert.match(source,/'Accept-Profile': 'public', 'Content-Profile': 'public'/);
  assert.ok(source.includes("typeof info.uid !== 'string'"));
  assert.match(source,/getUserInfo exposes uid but no anonymous flag/);
  assert.match(read('cloudbase/migrations/20261111230000_activity_registration_write.sql'),/sub.status<>'approved'/);
  assert.ok(source.includes('return { registrations }'));
  assert.ok(source.includes('management_token_hash'));
  assert.ok(source.includes('suppliedToken'));
  assert.doesNotMatch(source,/signInAnonymously|auth\.sign|app\.rdb\(\)|pr_/i);
  assert.match(read('crm/js/modules/activity-registration-public.js'),/name: 'activity_registration_public'/);
});

test('one bearer credential can span registrations while rollback preserves uniqueness safely',()=>{
  const migration=read('cloudbase/migrations/20261110160000_activity_registration_shared_token.sql');
  const rollback=read('cloudbase/migrations/20261110160000_activity_registration_shared_token.rollback.sql');
  assert.match(migration,/ALTER TABLE public\.activity_registration_submissions[\s\S]*DROP CONSTRAINT activity_registration_submissions_management_token_hash_key/);
  assert.match(migration,/CREATE INDEX activity_registration_submissions_management_token_hash_idx/);
  assert.match(rollback,/GROUP BY management_token_hash[\s\S]*HAVING count\(\*\) > 1/);
  assert.match(rollback,/refusing to restore per-registration uniqueness/);
  assert.match(rollback,/ADD CONSTRAINT activity_registration_submissions_management_token_hash_key UNIQUE/);
});

test('anonymous gateway reaches only the public function, while CRM actions require the staff handler',()=>{
  const policy=read('cloudbase/permissions/activity-registration.rego');
  const rollback=read('cloudbase/permissions/activity-registration.rollback.rego');
  const backend=read('cloudfunctions/activity_registration/index.js');
  const publicCopy=read('cloudfunctions/activity_registration_public/index.js');
  const guard = "exports.main = require('./device-runtime').protect('activity_registration', exports.main);";
  assert.ok(backend.trimEnd().endsWith(guard));
  assert.equal(publicCopy.trimEnd(),backend.trimEnd().slice(0,-guard.length).trimEnd());
  assert.match(policy,/"\/v1\/functions\/activity_registration_public": "POST"/);
  assert.doesNotMatch(policy,/"\/v1\/functions\/activity_registration": "POST"/);
  assert.match(policy,/not mcp_public_request/);
  assert.doesNotMatch(rollback,/activity_registration_public/);
  assert.match(backend,/publicOnly \? !PUBLIC_ACTIONS\.has\(action\) : PUBLIC_ACTIONS\.has\(action\)/);
});

test('new public and Console labels resolve in both supported locales',async()=>{
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  globalThis.document={querySelectorAll:()=>[]};
  const i18n=await import(pathToFileURL(path.join(root,'crm/js/modules/console/i18n.js')).href);
  const sources=['crm/js/modules/activity-registration-public.js','crm/js/modules/console/activity-registrations.js'];
  const keys=new Set();
  for(const file of sources){
    for(const [,key] of read(file).matchAll(/\bt\(['"]([^'"]+)['"]\)/g))keys.add(key);
  }
  for(const key of keys){
    i18n.setLang('zh-CN');assert.notEqual(i18n.t(key),key,`missing zh-CN key ${key}`);
    i18n.setLang('en');assert.notEqual(i18n.t(key),key,`missing English key ${key}`);
  }
  i18n.setLang('zh-CN');
});

test('public page uses only the browser-safe publishable key, never a service key',()=>{
  const html=read('crm/activity-registration.html');
  const script=html.match(/<script>(window\.APP_CONFIG = \{[^<]+\});<\/script>/)?.[1];
  assert.ok(script,'public app configuration exists');
  const context={window:{}};vm.runInNewContext(script,context);
  assert.equal(context.window.APP_CONFIG.envId,'crm-d1gkae8ddc930d151');
  assert.equal(typeof context.window.APP_CONFIG.accessKey,'string');
  assert.ok(context.window.APP_CONFIG.accessKey.length>=20);
  assert.doesNotMatch(script,/CRM_ACTIVITY_REGISTRATION_DB_API_KEY|service_role/i);
});
