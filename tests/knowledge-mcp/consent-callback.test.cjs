'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sourcePath=path.join(__dirname,'../../crm/js/modules/console/knowledge-mcp-consent.js');
const source=fs.readFileSync(sourcePath,'utf8')
  .replace(/^import \{ t, getLang, setLang \} from '\.\/i18n\.js';\s*/m,'')
  .replace(/^import \{ deviceCall, verifyDevice, guardResume \} from '\.\.\/device-access\/transport\.js';\s*/m,'');
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

test('follow-up OAuth consent explains separate read, review, and direct-write permissions bilingually',()=>{
  const dictionary=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/i18n.js'),'utf8');
  const consent=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/knowledge-mcp-consent.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../../crm/oauth-consent.html'),'utf8');
  for(const key of ['kmcp_followup_read','kmcp_followup_write','kmcp_followup_review','kmcp_followup_direct_write']) {
    assert.match(dictionary,new RegExp(`${key}: \\{'zh-CN':`));
    assert.match(dictionary,new RegExp(`${key}: \\{[^\\n]*'en':`));
  }
  assert.match(consent,/requested\.has\('followup:read'\)/);
  assert.match(consent,/requested\.has\('followup:gpt:submit'\)/);
  assert.match(consent,/requested\.has\('followup:gpt:direct_write'\)/);
  assert.match(html,/id="followupDirectWrite"/);
  assert.match(consent,/followupReview/);
});

test('OAuth consent checks approved browser proof on open, login, resume, and authorization calls',()=>{
  const consent=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/knowledge-mcp-consent.js'),'utf8');
  assert.match(consent,/import \{ deviceCall, verifyDevice, guardResume \} from '\.\.\/device-access\/transport\.js'/);
  assert.match(consent,/guardResume\(\(\) => state\.ready, \(\) => verifyDevice\(state\.app, CONFIG\.envId\)\)/);
  assert.match(consent,/await verifyDevice\(state\.app, CONFIG\.envId\)/);
  assert.match(consent,/deviceCall\(state\.app, CONFIG\.envId, name, data\)/);
  assert.doesNotMatch(consent,/state\.app\.callFunction\(\{\s*name,\s*data\s*\}\)/);
});

test('pending device guidance binds approval to the current full browser code in both languages',()=>{
  const dictionary=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/i18n.js'),'utf8');
  assert.match(dictionary,/device_pending: \{"zh-CN":"[^"]*完整设备码[^"]*不按设备名称或备注匹配/);
  assert.match(dictionary,/device_pending: \{[^\n]*"en":"[^"]*full code shown here[^"]*not its device name or label/);
});
