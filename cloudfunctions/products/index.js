/**
 * products — 保单检视明细（每客户一行，Person 入口带版本保护）。
 * 兼容既有 customer_id/list、upsert、remove 契约；新 Person 入口由服务端解析客户关联。
 */
'use strict';

const { rdb, normFields, assertOk } = require('./db');
const { normalizeInsuranceItems, amountColumns } = require('./contract');

const FIELDS = [
  'customer_id', 'customer_name', 'items',
  'ap_ipa', 'ap_ppa', 'ap_ltc', 'ap_ann', 'ap_life', 'ap_term',
  'ap_wl', 'ap_pa', 'ap_ci', 'ap_hi', 'ap_all',
];
const RETRIES = 4;
const AMOUNT_COLUMNS = ['ap_ipa', 'ap_ppa', 'ap_ltc', 'ap_ann', 'ap_life', 'ap_term', 'ap_wl', 'ap_pa', 'ap_ci', 'ap_hi', 'ap_all'];
const PERSON_PRODUCT_SELECT = ['id::text', 'version', 'customer_id::text', 'customer_name', 'items',
  ...AMOUNT_COLUMNS.map(column => `${column}::text`)].join(',');

exports.main = async (event) => {
  try {
    const action = event?.action || '';
    switch (action) {
      case 'list': return event.personId != null ? await listForPerson(event.personId) : await listLegacy(event);
      case 'upsert': return event.personId != null ? await upsertForPerson(event) : await upsertLegacy(event);
      case 'remove': return await remove(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e?.code ? { code: e.code, message: e.message } : e.message };
  }
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function idString(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) fail('INVALID_ID', `${label} is invalid`);
  return id;
}

function versionNumber(value, allowZero = false) {
  const text = String(value ?? '');
  if (!/^(0|[1-9]\d{0,9})$/.test(text)) fail('INVALID_VERSION', 'Invalid product version');
  const version = Number(text);
  if (!Number.isSafeInteger(version) || version > 2147483646 || (!allowZero && version < 1)) {
    fail('INVALID_VERSION', 'Invalid product version');
  }
  return version;
}

function uniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || error));
}

async function resolvePerson(personValue) {
  const personId = idString(personValue, 'Person ID');
  const person = assertOk(await rdb.from('persons').select('id::text,display_name')
    .eq('id', personId).is('deleted_at', null).maybeSingle());
  if (!person.data) fail('PERSON_NOT_FOUND', 'Person was not found or is deleted');
  const customer = assertOk(await rdb.from('customers').select('Id::text,person_id::text')
    .eq('person_id', personId).is('deleted_at', null).maybeSingle());
  if (!customer.data) return { personId, personName: person.data.display_name || '', customerId: null };
  return { personId, personName: person.data.display_name || '', customerId: String(customer.data.Id) };
}

async function findProduct(customerId, includeDeleted = false) {
  let query = rdb.from('products').select('id::text,version,deleted_at').eq('customer_id', customerId);
  if (!includeDeleted) query = query.is('deleted_at', null);
  return assertOk(await query.maybeSingle()).data || null;
}

async function listForCustomer(customerId, exactAmounts = false) {
  const select = exactAmounts ? PERSON_PRODUCT_SELECT : undefined;
  let query = rdb.from('products');
  query = exactAmounts ? query.select(select) : query.select();
  const result = assertOk(await query.eq('customer_id', customerId).is('deleted_at', null));
  const rows = result.data || [];
  if (rows.length > 1) fail('PRODUCT_DUPLICATE', 'Multiple product rows exist for this customer; contact an administrator');
  return rows;
}

async function listForPerson(personValue) {
  const identity = await resolvePerson(personValue);
  if (!identity.customerId) return { rows: [], customerId: null, version: null, personId: identity.personId };
  const rows = await listForCustomer(identity.customerId, true);
  return { rows, customerId: identity.customerId, personId: identity.personId,
    version: rows[0]?.version == null ? 0 : String(rows[0].version) };
}

async function listLegacy(event) {
  const customerId = idString(event.customer_id, 'customer_id');
  return { rows: await listForCustomer(customerId) };
}

function personPayload(data, customerId, personName) {
  const items = normalizeInsuranceItems(data.items);
  const payload = normFields(data, FIELDS);
  payload.customer_id = customerId;
  payload.customer_name = personName;
  payload.items = JSON.stringify(items);
  Object.assign(payload, amountColumns(items));
  return payload;
}

async function upsertForPerson(event) {
  const identity = await resolvePerson(event.personId);
  if (!identity.customerId) fail('CUSTOMER_LINK_REQUIRED', 'Establish the Person customer relationship before editing insurance');
  const expectedVersion = versionNumber(event.expectedVersion, true);
  const data = event.data || {};
  const payload = personPayload(data, identity.customerId, identity.personName);
  const existing = await findProduct(identity.customerId, true);

  if (!existing) {
    if (expectedVersion !== 0) fail('VERSION_CONFLICT', 'Insurance data changed. Reload before saving.');
    const inserted = await rdb.from('products').insert({ ...payload, version: 1 }).select('id,version');
    if (inserted?.error) {
      if (uniqueViolation(inserted.error)) fail('VERSION_CONFLICT', 'Insurance data changed. Reload before saving.');
      assertOk(inserted);
    }
    const row = inserted.data?.[0];
    if (!row) fail('SAVE_FAILED', 'Insurance data was not saved');
    return { id: String(row.id), version: String(row.version || 1), customerId: identity.customerId };
  }
  if (existing.deleted_at) fail('PRODUCT_DELETED', 'Insurance record is deleted; restore the customer record before editing');
  if (expectedVersion === 0 || versionNumber(existing.version) !== expectedVersion) {
    fail('VERSION_CONFLICT', 'Insurance data changed. Reload before saving.');
  }

  const nextVersion = expectedVersion + 1;
  const updated = await rdb.from('products').update({ ...payload, version: nextVersion })
    .eq('id', existing.id).eq('version', expectedVersion).is('deleted_at', null).select('id,version');
  assertOk(updated);
  const row = updated.data?.[0];
  if (!row) fail('VERSION_CONFLICT', 'Insurance data changed. Reload before saving.');
  return { id: String(row.id), version: String(row.version || nextVersion), customerId: identity.customerId };
}

async function customerNameFor(customerId) {
  const customer = assertOk(await rdb.from('customers').select('person_id::text')
    .eq('Id', customerId).maybeSingle());
  if (!customer.data) fail('CUSTOMER_NOT_FOUND', 'Customer was not found');
  if (!customer.data.person_id) return '';
  const person = assertOk(await rdb.from('persons').select('display_name')
    .eq('id', customer.data.person_id).is('deleted_at', null).maybeSingle());
  return person.data?.display_name || '';
}

async function upsertLegacy(event) {
  const data = Object.assign({}, event.data || {});
  const customerId = idString(data.customer_id, 'customer_id');
  if (!data.customer_name) data.customer_name = await customerNameFor(customerId);
  const payload = normFields(data, FIELDS);
  if (!Object.keys(payload).length) fail('NO_VALID_FIELDS', 'No valid fields');

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    const existing = await findProduct(customerId, true);
    if (existing) {
      const version = versionNumber(existing.version);
      const result = await rdb.from('products').update({ ...payload, version: version + 1 })
        .eq('id', existing.id).eq('version', version).select('id,version');
      assertOk(result);
      const row = result.data?.[0];
      if (row) return { id: row.id };
      continue;
    }
    const inserted = await rdb.from('products').insert({ ...payload, version: 1 }).select('id,version');
    if (inserted?.error) {
      if (uniqueViolation(inserted.error)) continue;
      assertOk(inserted);
    }
    const row = inserted.data?.[0];
    if (row) return { id: row.id };
  }
  fail('WRITE_CONFLICT', 'Insurance data changed repeatedly; reload and try again');
}

async function remove(event) {
  const id = idString(event.id, 'id');
  const result = assertOk(await rdb.from('products').delete().eq('id', id).select('id'));
  return { ok: (result.data || []).length === 1 };
}
