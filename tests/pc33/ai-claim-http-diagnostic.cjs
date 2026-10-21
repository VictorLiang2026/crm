'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchData } = require('../../cloudfunctions/assistant/search-data');

test('failed claim logs only a fixed database error category', async () => {
  const logs = [];
  const original = console.error;
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const data = createSearchData({ env: 'crm-test123', key: 'private-fixture-key',
      fetchImpl: async () => ({ ok: false, status: 400,
        text: async () => JSON.stringify({ code: 'P0001',
          message: 'AI claim key reused with different input',
          details: 'sensitive fictional input' }) }) });
    await assert.rejects(data.auditRdb.rpc('crm_ai_claim_v2', {}),
      /CRM search database request failed \(400\)/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"code":"P0001"/);
    assert.match(logs[0], /"category":"CLAIM_INPUT_MISMATCH"/);
    assert.doesNotMatch(logs[0], /sensitive|private-fixture-key|reused with different input/);
  } finally { console.error = original; }
});

test('unrecognized claim failure cannot log raw database details', async () => {
  const logs = [];
  const original = console.error;
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const data = createSearchData({ env: 'crm-test123', key: 'private-fixture-key',
      fetchImpl: async () => ({ ok: false, status: 400,
        text: async () => '{"code":"23505","message":"sensitive fictional row"}' }) });
    await assert.rejects(data.auditRdb.rpc('crm_ai_claim_v2', {}),
      /CRM search database request failed \(400\)/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"category":"DB_UNIQUE_VIOLATION"/);
    assert.doesNotMatch(logs[0], /sensitive|private-fixture-key/);
  } finally { console.error = original; }
});
