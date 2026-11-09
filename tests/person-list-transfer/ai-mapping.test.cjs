'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapPersonListFields } = require('../../cloudfunctions/assistant/person-list-field-mapping-service');
const { defaultRegistry } = require('../../cloudfunctions/assistant/skill-registry');

test('field mapping skill validates a bounded header-only contract', () => {
  const skill = defaultRegistry.get('person_list_field_mapping');
  assert.ok(skill);
  defaultRegistry.validateInput('person_list_field_mapping', { headers: ['姓名'], language: 'zh-CN' });
  defaultRegistry.validateOutput('person_list_field_mapping', { mappings: [
    { columnIndex: 0, field: 'display_name', confidence: 90, reason: '姓名' },
  ] });
  assert.equal(JSON.stringify(skill).includes('provider'), false);
  assert.equal(skill.confirmationLevel, 'review');
});

test('AI mapping receives headers only and unsupported mappings remain unmapped', async () => {
  let request;
  const result = await mapPersonListFields({ headers: ['姓名','电话','不确定列'], language: 'zh-CN' }, {
    app: {},
    databaseFactory: () => ({ auditRdb: {} }),
    gatewayFactory: () => ({ runAITask: async input => {
      request = input;
      return { result: { mappings: [
        { columnIndex: 0, field: 'display_name', confidence: 98, reason: '姓名列' },
        { columnIndex: 1, field: 'phone', confidence: 93, reason: '电话列' },
        { columnIndex: 2, field: 'delete_everything', confidence: 100, reason: 'invalid' },
      ] }, taskId: 'task', resultId: 'result', skillVersion: '1.0.0' };
    } }),
  });
  assert.deepEqual(Object.keys(request.input).sort(), ['headers','language']);
  assert.equal(JSON.stringify(request.input).includes('13800000000'), false);
  assert.deepEqual(result.mappings.map(row => row.field), ['display_name','phone',null]);
  assert.deepEqual(result.mappings.map(row => row.confidence), [98,93,100]);
});

test('field mapping rejects invalid and empty header sets', async () => {
  await assert.rejects(() => mapPersonListFields({ headers: [], language: 'en' }, {}), error => error.code === 'INVALID_INPUT');
  await assert.rejects(() => mapPersonListFields({ headers: [''], language: 'en' }, {}), error => error.code === 'INVALID_INPUT');
});

