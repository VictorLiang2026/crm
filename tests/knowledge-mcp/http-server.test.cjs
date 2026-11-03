'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const Module = require('node:module');
process.env.TCB_ENV='crm-d1gkae8ddc930d151';
process.env.CRM_KNOWLEDGE_MCP_CLOUDBASE_API_KEY='test-api-key';
process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY='test-only-hmac-secret-with-at-least-32-characters';
process.env.CRM_KNOWLEDGE_MCP_CONSENT_URI='https://crm.example/crm/oauth-consent.html';
process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL='https://crm.example';
process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL='https://crm.example/mcp/knowledge';
let mockCall=async()=>({result:{ok:true}});
const originalLoad = Module._load;
Module._load = function(request,parent,isMain) {
  if(request==='@cloudbase/node-sdk')return {init:()=>({callFunction:args=>mockCall(args)})};
  return originalLoad.call(this,request,parent,isMain);
};
const { createHttpServer,main } = require('../../cloudfunctions/knowledge_mcp');

test('redirect allowlist permits Codex loopback callbacks and rejects untrusted callback targets', () => {
  const {isAllowedRedirectUri}=require('../../cloudfunctions/knowledge_mcp');
  assert.equal(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'),true);
  assert.equal(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/callback_123'),true);
  assert.equal(isAllowedRedirectUri('http://127.0.0.1/callback'),true);
  assert.equal(isAllowedRedirectUri('http://127.0.0.1:49152/callback'),true);
  assert.equal(isAllowedRedirectUri('http://127.0.0.1:65535/callback'),true);
  for(const uri of [
    'http://127.0.0.1:65536/callback',
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1.evil.test/callback',
    'http://localhost/callback',
    'https://127.0.0.1/callback',
    'http://127.0.0.1/other',
    'http://127.0.0.1/callback?next=https://evil.test',
    'https://example.org/callback',
  ]) assert.equal(isAllowedRedirectUri(uri),false,uri);
});

test('dynamic registration rejects callbacks outside the ChatGPT and Codex loopback allowlists before database access', async () => {
  const keys=['TCB_ENV','CRM_KNOWLEDGE_MCP_HMAC_KEY','CRM_KNOWLEDGE_MCP_CONSENT_URI',
    'CRM_KNOWLEDGE_MCP_RESOURCE_URL','CRM_KNOWLEDGE_MCP_ISSUER_URL'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const modulePath=require.resolve('../../cloudfunctions/knowledge_mcp');
  try {
    process.env.TCB_ENV='crm-d1gkae8ddc930d151';
    process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY='test-only-hmac-secret-with-at-least-32-characters';
    process.env.CRM_KNOWLEDGE_MCP_CONSENT_URI='https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/oauth-consent.html';
    process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL='https://crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com';
    process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL='https://crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com/mcp/knowledge';
    delete require.cache[modulePath];
    const {main}=require('../../cloudfunctions/knowledge_mcp');
    const metadataUrl=process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL+'/.well-known/oauth-authorization-server/knowledge-mcp';
    const metadata=await main({httpMethod:'GET',url:metadataUrl,headers:{}},
      {httpContext:{httpMethod:'GET',url:metadataUrl,headers:{}}});
    assert.equal(metadata.statusCode,200);
    const metadataBody=JSON.parse(metadata.body);
    assert.equal(metadataBody.issuer,process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL+'/knowledge-mcp');
    assert.equal(metadataBody.authorization_endpoint,'https://crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com/oauth/authorize');
    const registerUrl=new URL('/oauth/register',process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL).toString();
    const result=await main({httpMethod:'POST',url:registerUrl,
      headers:{'content-type':'application/json'},body:JSON.stringify({
        redirect_uris:['https://example.org/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code']
      })},{httpContext:{httpMethod:'POST',url:registerUrl,headers:{'content-type':'application/json'}}});
    assert.equal(result.statusCode,400);
    assert.equal(JSON.parse(result.body).error,'invalid_request');

    const tokenUrl=new URL('/oauth/token',process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL).toString();
    const unsupportedGrant=await main({httpMethod:'POST',url:tokenUrl,
      headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials'})},
    {httpContext:{httpMethod:'POST',url:tokenUrl,headers:{'content-type':'application/json'}}});
    assert.equal(unsupportedGrant.statusCode,400);
    assert.equal(JSON.parse(unsupportedGrant.body).error,'unsupported_grant_type');

    const mcpUrl=new URL('/mcp/knowledge',process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL).toString();
    const unauthenticated=await main({httpMethod:'POST',url:mcpUrl,headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})},
    {httpContext:{httpMethod:'POST',url:mcpUrl,headers:{'content-type':'application/json'}}});
    assert.equal(unauthenticated.statusCode,401);
    assert.match(unauthenticated.headers['WWW-Authenticate'],/^Bearer /);
  } finally {
    for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    delete require.cache[modulePath];
    require('../../cloudfunctions/knowledge_mcp');
  }
});

test('MCP metadata and tool contract expose text-only read and summary-only submit scopes',async()=>{
  const resource=process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL;
  const metadataUrl='https://crm.example/.well-known/oauth-protected-resource/mcp/knowledge';
  const metadata=await main({httpMethod:'GET',url:metadataUrl,headers:{}},{httpContext:{httpMethod:'GET',url:metadataUrl,headers:{}}});
  assert.deepEqual(JSON.parse(metadata.body).scopes_supported,['knowledge:read','knowledge:gpt:submit','followup:read','followup:gpt:submit']);
  mockCall=async({data})=>({result:data.input.operation==='access'?{ok:true,actorUid:'crm-user',resource,
    scopes:['knowledge:read','knowledge:gpt:submit']}:{ok:true,record:{}}});
  const url=resource;
  const result=await main({httpMethod:'POST',url,headers:{authorization:'Bearer '+'a'.repeat(40),'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})},
  {httpContext:{httpMethod:'POST',url,headers:{authorization:'Bearer '+'a'.repeat(40),'content-type':'application/json'}}});
  assert.equal(result.statusCode,200);
  assert.ok(Array.isArray(JSON.parse(result.body).result.tools));
  const listed=JSON.parse(result.body).result.tools;
  assert.equal(listed.some(tool=>tool.securitySchemes?.some(s=>s.scopes?.includes('knowledge:source:read'))),false);
  const submit=listed.find(tool=>tool.name==='knowledge_generate_gpt_pending');
  assert.deepEqual(submit.inputSchema.properties.table.enum,['knowledge_items','playbooks']);
  assert.match(submit.description,/stored system original text/);
  assert.doesNotMatch(submit.description,/attachment|file bytes/i);
  const task=listed.find(tool=>tool.name==='followup_gpt_task_package');
  assert.deepEqual(task.securitySchemes[0].scopes,['followup:read']);
  assert.equal(task.inputSchema.properties.limit.maximum,10);
  const preview=listed.find(tool=>tool.name==='followup_gpt_import_preview');
  assert.deepEqual(preview.securitySchemes[0].scopes,['followup:read','followup:gpt:submit']);
  assert.match(preview.description,/does not save/);
  const confirm=listed.find(tool=>tool.name==='followup_gpt_import_confirm');
  assert.deepEqual(confirm.securitySchemes[0].scopes,['followup:read','followup:gpt:submit']);
  assert.equal(Object.hasOwn(confirm.inputSchema.properties,'confirmed'),false);
});

test('follow-up-only grants can read task packages but cannot call knowledge or submit without the write scope',async()=>{
  const resource=process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL,url=resource,headers={authorization:'Bearer '+'b'.repeat(40),'content-type':'application/json'};
  let delegated=null;
  mockCall=async({data})=>{
    if(data.input.operation==='access')return {result:{ok:true,actorUid:'crm-user',resource,scopes:['followup:read']}};
    delegated=data.input;return {result:{ok:true,count:0,rows:[]}};
  };
  const list=await main({httpMethod:'POST',url,headers,body:JSON.stringify({jsonrpc:'2.0',id:31,method:'tools/list'})},
    {httpContext:{httpMethod:'POST',url,headers}});
  assert.equal(list.statusCode,200);
  const taskCall=await main({httpMethod:'POST',url,headers,body:JSON.stringify({jsonrpc:'2.0',id:32,method:'tools/call',
    params:{name:'followup_gpt_task_package',arguments:{personId:'42',limit:1}}})},{httpContext:{httpMethod:'POST',url,headers}});
  assert.equal(JSON.parse(taskCall.body).result.isError,false);
  assert.deepEqual(delegated,{tool:'followup_gpt_task_package',personId:'42',limit:1});
  const noKnowledge=await main({httpMethod:'POST',url,headers,body:JSON.stringify({jsonrpc:'2.0',id:33,method:'tools/call',
    params:{name:'knowledge_records_list',arguments:{limit:1}}})},{httpContext:{httpMethod:'POST',url,headers}});
  assert.deepEqual(JSON.parse(noKnowledge.body).result._meta['mcp/www_authenticate'],
    ['Bearer resource_metadata="https://crm.example/.well-known/oauth-protected-resource/mcp/knowledge", error="insufficient_scope", scope="knowledge:read"']);
  const noWrite=await main({httpMethod:'POST',url,headers,body:JSON.stringify({jsonrpc:'2.0',id:34,method:'tools/call',
    params:{name:'followup_gpt_import_preview',arguments:{rows:[{}]}}})},{httpContext:{httpMethod:'POST',url,headers}});
  assert.match(JSON.stringify(JSON.parse(noWrite.body).result._meta),/followup:read followup:gpt:submit/);
});

test('follow-up OAuth authorization accepts a distinct scope pair and rejects an unpaired submit scope',async()=>{
  const origin=process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL,resource=process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL;
  const makeUrl=scope=>`${origin}/oauth/authorize?client_id=client-1&redirect_uri=${encodeURIComponent('https://chatgpt.com/connector_platform_oauth_redirect')}`+
    `&resource=${encodeURIComponent(resource)}&state=s1&response_type=code&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&scope=${encodeURIComponent(scope)}`;
  mockCall=async({data})=>({result:data.input.operation==='validate_client'?{ok:true}:{ok:true}});
  const allowedUrl=makeUrl('followup:read followup:gpt:submit');
  const allowed=await main({httpMethod:'GET',url:allowedUrl,headers:{}},{httpContext:{httpMethod:'GET',url:allowedUrl,headers:{}}});
  assert.equal(allowed.statusCode,302);
  assert.equal(new URL(allowed.headers.Location).searchParams.get('scope'),'followup:read followup:gpt:submit');
  const invalidUrl=makeUrl('followup:gpt:submit');
  const invalid=await main({httpMethod:'GET',url:invalidUrl,headers:{}},{httpContext:{httpMethod:'GET',url:invalidUrl,headers:{}}});
  assert.equal(invalid.statusCode,400);
});

test('MCP list failures retain only safe error codes and shape diagnostics',async()=>{
  const resource=process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL;
  mockCall=async({data})=>data.input.operation==='access'?{result:{ok:true,actorUid:'crm-user',resource,
    scopes:['knowledge:read','knowledge:gpt:submit']}}:(assert.equal(data.input.tool,'knowledge_records_list'),{result:{ok:false,error:{code:'INVALID_INPUT',message:'private detail',
      diagnostic:{recognizedTool:true,toolName:'knowledge_records_list',fieldCount:3,secret:'never expose'}}}});
  const url=resource,headers={authorization:'Bearer '+'a'.repeat(40),'content-type':'application/json'};
  const result=await main({httpMethod:'POST',url,headers,body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'knowledge_records_list',arguments:{limit:50}}})},{httpContext:{httpMethod:'POST',url,headers}});
  const body=JSON.parse(result.body),safe=JSON.parse(body.result.content[0].text);
  assert.equal(body.result.isError,true);
  assert.equal(safe.ok,false);
  assert.deepEqual(safe.error,{code:'INVALID_INPUT',diagnostic:{recognizedTool:true,toolName:'knowledge_records_list',fieldCount:3}});
  assert.deepEqual(safe.rows,[]);
  assert.deepEqual(safe.coverage,{});
  assert.doesNotMatch(JSON.stringify(safe),/private detail|never expose/);
});

test('HTTP runtime serves JSON health checks and bounds request bodies', async t => {
  const server = createHttpServer({ port: 0 });
  server.unref();
  await once(server, 'listening');
  t.after(() => { http.globalAgent.destroy(); server.closeAllConnections(); server.close(); });
  const { port } = server.address();

  const health = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/health' }, response => {
      let raw = ''; response.setEncoding('utf8'); response.on('data', chunk => raw += chunk);
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body: raw }));
    }).on('error', reject);
  });
  assert.equal(health.status, 200);
  assert.match(health.type, /application\/json/);
  assert.deepEqual(JSON.parse(health.body), { ok: true });

  const wrongMethod = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/mcp/knowledge' }, response => {
      let raw = ''; response.setEncoding('utf8'); response.on('data', chunk => raw += chunk);
      response.on('end', () => resolve({ status: response.statusCode, allow: response.headers.allow }));
    }).on('error', reject);
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.allow, 'POST');

  const oversized = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/mcp/knowledge', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 1024 * 1024 + 1 } }, response => {
      let raw = ''; response.setEncoding('utf8'); response.on('data', chunk => raw += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body: raw }));
    });
    request.on('error', reject);
    request.end(Buffer.alloc(1024 * 1024 + 1, 0x20));
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(JSON.parse(oversized.body), { error: 'REQUEST_TOO_LARGE' });
});
