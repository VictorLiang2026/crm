'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signAssertion, verifyAssertion, assertionFailure, expectedKnowledgeMcpIssuer, validateScopes } = require('../../cloudfunctions/assistant/knowledge-mcp-auth');

const secret = 'test-only-secret-that-is-at-least-thirty-two-characters';

test('pathful OAuth issuer is derived from the configured HTTPS origin', () => {
  assert.equal(expectedKnowledgeMcpIssuer('https://crm.example'), 'https://crm.example/knowledge-mcp');
  assert.equal(expectedKnowledgeMcpIssuer('http://crm.example'), '');
  assert.equal(expectedKnowledgeMcpIssuer('https://crm.example/other'), '');
});

test('follow-up OAuth scopes stay separate and submit scopes require their matching read scope',()=>{
  assert.deepEqual(validateScopes('followup:read followup:gpt:submit'),['followup:read','followup:gpt:submit']);
  assert.deepEqual(validateScopes('followup:read followup:gpt:direct_write'),['followup:read','followup:gpt:direct_write']);
  assert.deepEqual(validateScopes('knowledge:read knowledge:gpt:submit'),['knowledge:read','knowledge:gpt:submit']);
  assert.throws(()=>validateScopes('followup:gpt:submit'),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>validateScopes('followup:gpt:direct_write'),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>validateScopes('knowledge:read followup:gpt:submit'),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>validateScopes('knowledge:read followup:gpt:direct_write'),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>validateScopes('knowledge:read knowledge:read'),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>validateScopes('knowledge:read followup:admin'),error=>error.code==='INVALID_INPUT');
});

test('signed internal assertions bind actor, audience, expiry, and complete payload', () => {
  const now = 1_800_000_000_000;
  const input = { tool: 'knowledge_record_get', table: 'knowledge_items', id: '12' };
  const assertion = signAssertion('crm-user-1', secret, input, now);

  assert.equal(verifyAssertion(assertion, secret, input, now), 'crm-user-1');
  assert.equal(verifyAssertion(assertion, secret, { id: '12', table: 'knowledge_items', tool: 'knowledge_record_get' }, now), 'crm-user-1');
  assert.equal(assertionFailure(assertion, secret, input, now), null);
  assert.equal(verifyAssertion(assertion, secret, input, now + 30_001), null);
  assert.equal(verifyAssertion(assertion, secret, { ...input, id: '13' }, now), null);
  assert.equal(assertionFailure(assertion, secret, { ...input, id: '13' }, now), 'ASSERTION_PAYLOAD_MISMATCH');
  assert.equal(verifyAssertion({ ...assertion, audience: 'another-service' }, secret, input, now), null);
  assert.equal(verifyAssertion({ ...assertion, actorUid: 'crm-user-2' }, secret, input, now), null);
});

test('assertion verification fails closed on missing secret or malformed payload', () => {
  const now = 1_800_000_000_000;
  const assertion = signAssertion('crm-user-1', secret, { tool: 'knowledge_records_list' }, now);
  assert.equal(verifyAssertion(assertion, 'short', { tool: 'knowledge_records_list' }, now), null);
  assert.equal(assertionFailure(assertion, 'short', { tool: 'knowledge_records_list' }, now), 'INVALID_SECRET_CONFIG');
  assert.equal(verifyAssertion(assertion, secret, null, now), null);
  assert.equal(assertionFailure(assertion, secret, { tool: 'knowledge_records_list' }, now + 30_001), 'ASSERTION_TIME_WINDOW');
  assert.equal(verifyAssertion({ ...assertion, signature: 'not-a-signature' }, secret, { tool: 'knowledge_records_list' }, now), null);
  assert.equal(assertionFailure({ ...assertion, signature: 'not-a-signature' }, secret, { tool: 'knowledge_records_list' }, now), 'ASSERTION_SIGNATURE_MISMATCH');
});
