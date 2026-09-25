'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonService, parsePersonName } = require('../../cloudfunctions/_shared/person-service');

function fixture(rows = [], error = null) {
  const calls = [];
  const rdb = { from(table) {
    const call = { table, filters: {}, limit: null };
    calls.push(call);
    return {
      select(fields) { call.fields = fields; return this; },
      eq(field, value) { call.filters[field] = value; return this; },
      is(field, value) { call.filters[field] = value; return this; },
      order(field, options) { call.order = { field, options }; return this; },
      limit(value) { call.limit = value; return this; },
      then(resolve, reject) {
        const data = rows.filter(row => row.name_key === call.filters.name_key && row.deleted_at == null)
          .slice(0, call.limit).map(row => Object.fromEntries(call.fields.split(',')
            .filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])));
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
  } };
  return { service: new PersonService({ rdb }), calls };
}

const person = (id, displayName, nameKey = '张玮') => ({
  id, display_name: displayName, name_key: nameKey, organization: null,
  occupation: null, legacy_customer_id: id, deleted_at: null,
});

test('name_key strips only trailing qualifiers and normalizes spaces', () => {
  assert.deepEqual(parsePersonName(' 张玮（电信） '), {
    displayName: '张玮（电信）', nameKey: '张玮', qualifierKey: '电信', hasQualifier: true,
  });
  assert.equal(parsePersonName('张玮(电信)').nameKey, '张玮');
  assert.equal(parsePersonName('张　玮（电信）（朋友）').nameKey, '张 玮');
  assert.equal(parsePersonName('王（小）明').nameKey, '王（小）明');
  assert.throws(() => parsePersonName('（电信）'), error => error.code === 'INVALID_NAME');
  assert.throws(() => parsePersonName('张玮（电信'), error => error.code === 'INVALID_NAME');
  assert.throws(() => parsePersonName('张玮（）'), error => error.code === 'INVALID_NAME');
});

test('zero results allow a new person without selecting an identity', async () => {
  const { service, calls } = fixture();
  const result = await service.resolveName('张玮（电信）');
  assert.equal(result.status, 'available');
  assert.equal(result.canCreate, true);
  assert.equal(result.selectedPersonId, null);
  assert.deepEqual(calls[0], { table: 'public.persons',
    filters: { name_key: '张玮', deleted_at: null },
    fields: 'id,display_name,name_key,organization,occupation,legacy_customer_id',
    order: { field: 'id', options: { ascending: true } }, limit: 11 });
});

test('one result always needs human confirmation, even with a different qualifier', async () => {
  const { service } = fixture([person(1, '张玮（电信）')]);
  for (const input of ['张玮', '张玮（银行）']) {
    const result = await service.resolveName(input);
    assert.equal(result.status, 'confirm_existing');
    assert.equal(result.requiresHumanDecision, true);
    assert.equal(result.canCreate, false);
    assert.equal(result.selectedPersonId, null);
    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['1']);
    assert.equal(result.canCreateAfterConfirmation, input === '张玮（银行）');
  }
});

test('multiple results require choice or qualifier; a qualifier never auto-selects', async () => {
  const { service } = fixture([person(1, '张玮（电信）'), person(2, '张玮(银行)')]);
  const plain = await service.resolveName('张玮');
  assert.equal(plain.status, 'choose_or_qualify');
  assert.equal(plain.selectedPersonId, null);
  const matched = await service.resolveName('张玮（银行）');
  assert.equal(matched.status, 'confirm_qualified_match');
  assert.deepEqual(matched.qualifierMatches, ['2']);
  assert.equal(matched.selectedPersonId, null);
  const newQualified = await service.resolveName('张玮（学校）');
  assert.equal(newQualified.status, 'confirm_new_qualified');
  assert.equal(newQualified.canCreate, false);
  assert.equal(newQualified.canCreateAfterConfirmation, true);
  assert.equal(newQualified.selectedPersonId, null);
});

test('truncated or duplicate-qualifier results remain ambiguous', async () => {
  const many = Array.from({ length: 12 }, (_, i) => person(i + 1, `张玮（${i + 1}）`));
  const { service } = fixture(many);
  const result = await service.resolveName('张玮（12）');
  assert.equal(result.status, 'choose_or_qualify');
  assert.equal(result.hasMore, true);
  assert.equal(result.candidates.length, 10);
  const duplicate = fixture([person(1, '张玮（电信）'), person(2, '张玮(电信)')]);
  assert.equal((await duplicate.service.resolveName('张玮（电信）')).status, 'choose_or_qualify');
});

test('deleted records are excluded and read failures fail closed', async () => {
  const deleted = person(1, '张玮（电信）');
  deleted.deleted_at = '2026-09-25';
  assert.equal((await fixture([deleted]).service.resolveName('张玮')).status, 'available');
  await assert.rejects(fixture([], { message: 'denied' }).service.resolveName('张玮'),
    error => error.code === 'READ_FAILED');
  assert.throws(() => new PersonService(), error => error.code === 'INVALID_CONFIG');
  const inconsistent = fixture([person(1, '另一人', '张玮')]);
  await assert.rejects(inconsistent.service.resolveName('张玮'), error => error.code === 'READ_FAILED');
});
