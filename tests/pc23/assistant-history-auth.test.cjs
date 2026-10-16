'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../../cloudfunctions/assistant');

test('Person AI history is behind the existing authenticated assistant boundary', async () => {
  const main = createMain(() => ({ uid: 'anonymous', isAnonymous: true }));
  const response = await main({ action: 'personAIHistory', personId: '783' });
  assert.deepEqual(response, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } });
});
