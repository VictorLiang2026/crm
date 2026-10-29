/**
 * gifts — 伴手礼 CRUD（事件云函数，rdb() 版）
 * 入参 event: { action, ... }
 *   list:   { action:'list', person_id | customer_id } → { rows }
 *   create: { action:'create', data:{ person_id?, customer_id?, gift_name, quantity, notes, given_date } } → { id }
 *   update/remove accept person_id or legacy customer_id scope.
 * gifts.created_at 有默认 now()；无 updated_at 列。
 */
'use strict';

const { rdb, normFields, assertOk } = require('./db');

const FIELDS = ['person_id', 'customer_id', 'customer_name', 'gift_name', 'quantity', 'notes', 'given_date'];

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || '';
    switch (action) {
      case 'list':   return await list(event);
      case 'create': return await create(event);
      case 'update': return await update(event);
      case 'remove': return await remove(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e.message };
  }
};

async function list(event) {
  const personId = parseInt(event.person_id, 10);
  const customerId = parseInt(event.customer_id, 10);
  if (!personId && !customerId) return { error: 'person_id or customer_id required' };
  let q = rdb.from('gifts').select().eq(personId ? 'person_id' : 'customer_id', personId || customerId).is('deleted_at', null)
    .order('given_date', { ascending: false, nullsFirst: false })
    .order('Id', { ascending: false });
  if (event.limit !== undefined || event.offset !== undefined) {
    const limit = Number.parseInt(event.limit, 10);
    const offset = Number.parseInt(event.offset || 0, 10);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
      return { error: 'invalid pagination' };
    }
    const pageSize = Math.min(limit, 50);
    const r = assertOk(await q.range(offset, offset + pageSize));
    const rows = r.data || [];
    return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, nextOffset: offset + Math.min(rows.length, pageSize) };
  }
  const r = assertOk(await q);
  return { rows: r.data || [] };
}

async function create(event) {
  const data = Object.assign({}, event.data || {});
  let customerId = data.customer_id == null ? null : parseInt(data.customer_id, 10);
  let personId = data.person_id == null ? null : parseInt(data.person_id, 10);
  if (data.customer_id != null && !customerId) return { error: 'invalid customer_id' };
  if (data.person_id != null && !personId) return { error: 'invalid person_id' };
  if (!personId && !customerId) return { error: 'person_id or customer_id required' };
  if (!data.gift_name) return { error: 'gift_name required' };
  if (customerId) {
    const c = assertOk(await rdb.from('customers').select('person_id').eq('Id', customerId).is('deleted_at', null).maybeSingle());
    if (!c.data || !c.data.person_id) return { error: 'customer not found or not linked to a person' };
    if (personId && Number(c.data.person_id) !== personId) return { error: 'person/customer mismatch' };
    personId = Number(c.data.person_id);
  }
  const p = assertOk(await rdb.from('persons').select('display_name').eq('id', personId).is('deleted_at', null).maybeSingle());
  if (!p.data) return { error: 'person not found' };
  data.person_id = personId;
  data.customer_id = customerId;
  if (!data.customer_name) data.customer_name = p.data.display_name || '';
  const payload = normFields(data, FIELDS);
  if (!Object.keys(payload).length) return { error: 'no valid fields' };
  const r = assertOk(await rdb.from('gifts').insert(payload).select('Id'));
  return { id: r.data[0].Id };
}

async function update(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const customerId = event.customer_id == null ? null : parseInt(event.customer_id, 10);
  const personId = event.person_id == null ? null : parseInt(event.person_id, 10);
  if (event.customer_id != null && !customerId) return { error: 'invalid customer_id' };
  if (event.person_id != null && !personId) return { error: 'invalid person_id' };
  const payload = normFields(event.data || {}, ['customer_id', 'customer_name', 'gift_name', 'quantity', 'notes', 'given_date']);
  if (!Object.keys(payload).length) return { ok: true, updated: false };
  let q = rdb.from('gifts').update(payload).eq('Id', id);
  if (personId || customerId) q = q.eq(personId ? 'person_id' : 'customer_id', personId || customerId);
  const r = assertOk(await q.select('Id'));
  return { ok: (r.data || []).length === 1 };
}

async function remove(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const customerId = event.customer_id == null ? null : parseInt(event.customer_id, 10);
  const personId = event.person_id == null ? null : parseInt(event.person_id, 10);
  if (event.customer_id != null && !customerId) return { error: 'invalid customer_id' };
  if (event.person_id != null && !personId) return { error: 'invalid person_id' };
  let q = rdb.from('gifts').delete().eq('Id', id);
  if (personId || customerId) q = q.eq(personId ? 'person_id' : 'customer_id', personId || customerId);
  const r = assertOk(await q.select('Id'));
  return { ok: (r.data || []).length === 1 };
}
