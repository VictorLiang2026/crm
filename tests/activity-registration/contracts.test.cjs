'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
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
  assert.ok(source.includes('return dispatch(event,true)'));
  const signed=read('cloudfunctions/activity_registration/registration-signed.js');
  const db=read('cloudbase/migrations/20261111235500_activity_registration_signed.sql');
  assert.match(source,/registrationStaff/);
  assert.match(source,/ownerHash=crypto/);
  assert.doesNotMatch(source+signed,/CRM_ACTIVITY_REGISTRATION_DB_API_KEY/);
  assert.match(signed,/CRM_REGISTRATION_SIGNING_KEY/);
  assert.match(db,/s.management_token_hash=h/);
  assert.match(db,/public.crm_registration_public_data_v1/);
  assert.match(db,/public.crm_registration_staff_data_v1/);
  assert.doesNotMatch(source,/signInAnonymously|auth\.sign|app\.rdb\(\)|pr_/i);
  assert.ok(read('crm/js/modules/activity-registration-public.js').includes('fetch(config.registrationEndpoint'));
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
  assert.ok(backend.includes('publicOnly ? !PUBLIC_ACTIONS.has(action) : !STAFF_ACTIONS.has(action)'));
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

test('public browser uses the dedicated HTTPS route with no SDK login or environment key',()=>{
  const html=read('crm/activity-registration.html');
  assert.ok(html.includes('https://crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com/v1/functions/activity_registration_public'));
  assert.doesNotMatch(html,/accessKey|service_role|cloudbase.full.js/);
});
