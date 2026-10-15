'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS = new Set(['confirm', 'correct', 'expire', 'withdraw', 'promote']);

function idOf(value, label) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`Invalid context item ${label}`);
  }
  return Number(text);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizePayload(operation, value) {
  if (!plain(value)) throw new Error('Invalid context item draft');
  if (!['correct', 'promote'].includes(operation)) {
    if (Object.keys(value).length) throw new Error('Invalid context item draft');
    return {};
  }
  if (Object.keys(value).some(key => !['content', 'category'].includes(key)) ||
      typeof value.content !== 'string' || typeof value.category !== 'string' ||
      !value.content.trim() || value.content.trim().length > 4000 ||
      !value.category.trim() || value.category.trim().length > 64) {
    throw new Error('Invalid context item draft');
  }
  return { content: value.content.trim(), category: value.category.trim() };
}

class ContextItemLifecycleService {
  constructor({ rpc } = {}) {
    if (typeof rpc !== 'function') throw new Error('Authorized context item command access is required');
    this.rpc = rpc;
  }

  async preview(data, actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || !plain(data) ||
        Object.keys(data).some(key => !['idempotencyKey', 'personId', 'itemId', 'operation', 'payload'].includes(key)) ||
        !UUID.test(String(data.idempotencyKey || '')) || !OPERATIONS.has(data.operation)) {
      throw new Error('Invalid context item preview');
    }
    const personId = idOf(data.personId, 'Person ID');
    const itemId = idOf(data.itemId, 'ID');
    const payload = normalizePayload(data.operation, data.payload || {});
    return this.rpc('crm_context_item_preview_v1', {
      p_actor_uid: actorUid, p_idempotency_key: data.idempotencyKey,
      p_person_id: personId, p_item_id: itemId,
      p_operation: data.operation, p_payload: payload,
    });
  }

  async execute(previewId, actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || !UUID.test(String(previewId || ''))) {
      throw new Error('Invalid context item execution');
    }
    return this.rpc('crm_context_item_execute_v1', {
      p_actor_uid: actorUid, p_preview_id: previewId,
    });
  }
}

module.exports = { ContextItemLifecycleService, normalizePayload, idOf };
