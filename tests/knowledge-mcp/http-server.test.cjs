'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHttpServer } = require('../../cloudfunctions/knowledge_mcp');

test('dynamic registration rejects callbacks outside the ChatGPT allowlist before database access', async () => {
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
