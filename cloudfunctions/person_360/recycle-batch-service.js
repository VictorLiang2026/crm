'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['customer', 'recruit', 'person_recruit']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function actor(uid) {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) throw new Error('Invalid recycle actor');
}
function selection(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Invalid recycle selection');
  const seen = new Set();
  const rows = items.map(item => {
    if (!plain(item) || Object.keys(item).length !== 2 || !KINDS.has(item.kind) ||
        !Number.isSafeInteger(item.id) || item.id < 1 || (item.kind === 'customer' && item.id > 2147483647)) {
      throw new Error('Invalid recycle item');
    }
    const key = `${item.kind === 'customer' ? 'customer' : 'recruit'}:${item.id}`;
    if (seen.has(key)) throw new Error('Invalid duplicate recycle item');
    seen.add(key);
    return { kind: item.kind, id: item.id };
  });
  if (rows.some(x => x.kind === 'customer') && rows.some(x => x.kind !== 'customer')) {
    throw new Error('Invalid mixed recycle selection');
  }
  return rows;
}

class RecycleBatchService {
  constructor({ rpc } = {}) {
    if (typeof rpc !== 'function') throw new Error('Authorized recycle command access is required');
    this.rpc = rpc;
  }
  preview(data, uid) {
    actor(uid);
    if (!plain(data) || Object.keys(data).some(k => !['requestKey','items'].includes(k)) ||
        typeof data.requestKey !== 'string' || !UUID.test(data.requestKey)) throw new Error('Invalid recycle preview');
    return this.rpc('crm_recycle_batch_v1', { p_actor_uid: uid, p_operation: 'preview',
      p_data: { requestKey: data.requestKey, items: selection(data.items) } });
  }
  receipt(operation, id, uid) {
    actor(uid);
    if (!['get','execute'].includes(operation) || typeof id !== 'string' || !UUID.test(id)) {
      throw new Error('Invalid recycle receipt');
    }
    return this.rpc('crm_recycle_batch_v1', { p_actor_uid: uid, p_operation: operation, p_data: { previewId: id } });
  }
}

module.exports = { RecycleBatchService, selection };
