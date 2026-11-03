'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sourcePath=path.join(__dirname,'../../crm/js/modules/console/knowledge-mcp-consent.js');
const source=fs.readFileSync(sourcePath,'utf8').replace(/^import \{ t, getLang, setLang \} from '\.\/i18n\.js';\s*/m,'');
const moduleUrl='data:text/javascript;base64,'+Buffer.from(source).toString('base64');

test('CRM consent page returns only ChatGPT or exact Codex loopback callbacks',async()=>{
  const {isAllowedAuthorizationCallback}=await import(moduleUrl);
  for(const uri of [
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/callback_123',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:48294/callback',
    'http://127.0.0.1:65535/callback',
  ]) assert.equal(isAllowedAuthorizationCallback(uri),true,uri);
  for(const uri of [
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:65536/callback',
    'http://127.0.0.1.evil.test/callback',
    'http://localhost:48294/callback',
    'https://127.0.0.1:48294/callback',
    'http://127.0.0.1:48294/other',
    'http://127.0.0.1:48294/callback?next=https://evil.test',
  ]) assert.equal(isAllowedAuthorizationCallback(uri),false,uri);
});

test('follow-up OAuth consent explains its separate read, submit, and human-review permissions bilingually',()=>{
  const dictionary=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/i18n.js'),'utf8');
  const consent=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/knowledge-mcp-consent.js'),'utf8');
  for(const key of ['kmcp_followup_read','kmcp_followup_write','kmcp_followup_review']) {
    assert.match(dictionary,new RegExp(`${key}: \\{'zh-CN':`));
    assert.match(dictionary,new RegExp(`${key}: \\{[^\\n]*'en':`));
  }
  assert.match(consent,/requested\.has\('followup:read'\)/);
  assert.match(consent,/requested\.has\('followup:gpt:submit'\)/);
  assert.match(consent,/followupReview/);
});
