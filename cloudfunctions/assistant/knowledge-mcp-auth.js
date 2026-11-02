'use strict';
const crypto = require('node:crypto');
const b64url = value => Buffer.from(value).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function timingSafeHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function assertionFailure(assertion, secret, input, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) return 'INVALID_SECRET_CONFIG';
  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) return 'INVALID_ASSERTION';
  const { actorUid, scope, audience, issuedAt, nonce, payloadHash, signature } = assertion;
  if (typeof actorUid !== 'string' || !actorUid.trim() || scope !== 'knowledge:mcp' || audience!=='crm-assistant') return 'INVALID_ASSERTION';
  if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > 30000) return 'ASSERTION_TIME_WINDOW';
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(nonce)) return 'INVALID_ASSERTION_NONCE';
  if(!input||typeof input!=='object'||Array.isArray(input))return 'INVALID_ASSERTION_INPUT';
  const actualPayloadHash=crypto.createHash('sha256').update(canonicalJson(input)).digest('hex');
  if(!timingSafeHex(payloadHash,actualPayloadHash))return 'ASSERTION_PAYLOAD_MISMATCH';
  const expected = crypto.createHmac('sha256', secret).update(`${actorUid}\n${scope}\n${audience}\n${issuedAt}\n${nonce}\n${payloadHash}`).digest('hex');
  return timingSafeHex(signature, expected) ? null : 'ASSERTION_SIGNATURE_MISMATCH';
}
function verifyAssertion(assertion, secret, input, now = Date.now()) {
  return assertionFailure(assertion, secret, input, now) ? null : assertion.actorUid;
}
function signAssertion(actorUid, secret, input, now = Date.now()) {
  if (typeof actorUid !== 'string' || !actorUid.trim() || typeof secret !== 'string' || secret.length < 32) throw new Error('INVALID_CONFIG');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('INVALID_INPUT');
  const assertion = { actorUid, scope: 'knowledge:mcp', audience:'crm-assistant', issuedAt: now, nonce: b64url(crypto.randomBytes(24)) };
  const payloadHash=crypto.createHash('sha256').update(canonicalJson(input)).digest('hex');
  assertion.payloadHash=payloadHash;
  assertion.signature = crypto.createHmac('sha256', secret).update(`${actorUid}\n${assertion.scope}\n${assertion.audience}\n${now}\n${assertion.nonce}\n${payloadHash}`).digest('hex');
  return assertion;
}
function expectedKnowledgeMcpIssuer(origin) {
  try {
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.origin!==origin||url.pathname!=='/'||url.search||url.hash)return '';
    return url.origin+'/knowledge-mcp';
  } catch (_) { return ''; }
}
async function runOAuth(operation,data) {
  const allowed={
    register:['clientId','clientName','redirectUris'],
    validate_client:['clientId','redirectUri'],
    exchange:['clientId','redirectUri','resource','codeHash','codeChallenge','accessHash','refreshHash'],
    access:['accessHash'],
    refresh:['clientId','resource','refreshHash','newAccessHash','newRefreshHash'],
    revoke:['clientId','tokenHash'],
  };
  const keys=allowed[operation];
  if(!keys||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k))) {
    const error=new Error('INVALID_OAUTH_OPERATION');error.code='INVALID_INPUT';throw error;
  }
  const database=require('./search-data').createSearchData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const result=await database.auditRdb.rpc('crm_knowledge_mcp_oauth_v1',{p_operation:operation,p_data:data});
  if(result?.error||!result?.data||typeof result.data!=='object'){
    const error=new Error('OAUTH_STORAGE_FAILED');error.code='PERSISTENCE_ERROR';throw error;
  }
  return result.data;
}
async function issueAuthorization(event, actorUid) {
  const resource = process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL;
  const expectedIssuer=expectedKnowledgeMcpIssuer(process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL);
  const clientId = event.client_id;
  const redirectUri = event.redirect_uri;
  if (!resource || event.resource !== resource || !expectedIssuer || event.oauth_issuer!==expectedIssuer || typeof clientId!=='string' || typeof redirectUri!=='string' ||
      event.response_type !== 'code' || event.code_challenge_method !== 'S256' ||
    typeof event.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(event.code_challenge) ||
      typeof event.state !== 'string' || event.state.length < 1 || event.state.length > 1024) {
    const error = new Error('INVALID_OAUTH_REQUEST'); error.code = 'INVALID_INPUT'; throw error;
  }
  const requested = String(event.scope || '').split(/\s+/).filter(Boolean);
  const allowed = new Set(['knowledge:read', 'knowledge:gpt:submit']);
  if (!requested.includes('knowledge:read') || requested.some(scope => !allowed.has(scope)) || new Set(requested).size!==requested.length) {
    const error = new Error('INVALID_SCOPE'); error.code = 'INVALID_INPUT'; throw error;
  }
  const code = b64url(crypto.randomBytes(32));
  const data = require('./search-data').createSearchData({ env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const result = await data.auditRdb.rpc('crm_knowledge_mcp_oauth_v1', { p_operation: 'issue', p_data: {
    familyId: crypto.randomUUID(), clientId, actorUid, redirectUri, resource, scopes: requested,
    codeHash: hash(code), codeChallenge: event.code_challenge, codeChallengeMethod: 'S256',
  }});
  if (result?.error || !result?.data?.ok) { const error = new Error('OAUTH_STORAGE_FAILED'); error.code = 'PERSISTENCE_ERROR'; throw error; }
  return { ok: true, code, state: event.state, redirectUri };
}
module.exports = { verifyAssertion, assertionFailure, signAssertion, runOAuth, issueAuthorization, expectedKnowledgeMcpIssuer, hash, b64url, canonicalJson };
