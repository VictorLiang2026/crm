'use strict';

const ALLOWED_FIELDS = new Set([
  'phone', 'gender', 'birthday', 'occupation', 'education', 'marital_status',
  'customer_stage', 'sales_priority', 'referral_priority', 'hobbies', 'source', 'additional_info',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class OcrReviewService {
  constructor({ request, rpc, resolveName }) {
    if (typeof request !== 'function' || typeof rpc !== 'function' || typeof resolveName !== 'function') {
      throw new Error('OCR review service is not configured');
    }
    this.request = request;
    this.rpc = rpc;
    this.resolveName = resolveName;
  }

  async list(personIdValue, actorUid) {
    const personId = id(personIdValue, 'Person');
    if (!actorUid) throw new Error('UNAUTHORIZED');
    return this.request('crm_ocr_parse_commands', 'GET', {
      select: 'id,ocr_record_id,operation,parent_command_id,status,created_at,executed_at,result',
      actor_uid: `eq.${actorUid}`, person_id: `eq.${personId}`,
      order: 'created_at.desc,id.desc', limit: '50',
    });
  }

  async previewApply(data, actorUid) {
    if (!actorUid || data?.confirmed !== true) throw new Error('Human identity confirmation is required');
    const personId = id(data.personId, 'Person');
    const customerId = integer(data.customerId, 'Customer');
    const ocrRecordId = id(data.ocrRecordId, 'OCR record');
    const idempotencyKey = uuid(data.idempotencyKey);
    const identityName = boundedText(data.identityName, 160, 'Identity name');
    const selectedPersonId = id(data.selectedPersonId, 'Selected Person');
    if (selectedPersonId !== personId) throw new Error('Selected Person does not match this profile');
    const resolution = await this.resolveName(identityName);
    if (!resolution?.candidates?.some(candidate => String(candidate.id) === personId)) {
      throw new Error('OCR name did not resolve to this Person; choose the correct identity before previewing');
    }
    const selected = selectedFields(data.fields, data.selectedFields);
    const result = await this.rpc('crm_ocr_parse_preview_v1', {
      p_actor_uid: actorUid, p_idempotency_key: idempotencyKey,
      p_person_id: Number(personId), p_customer_id: customerId,
      p_ocr_record_id: ocrRecordId, p_selected: selected,
    });
    return { ...result, identity: { personId, displayName: resolution.candidates.find(c => String(c.id) === personId).displayName } };
  }

  async execute(previewId, actorUid) {
    if (!actorUid) throw new Error('UNAUTHORIZED');
    return this.rpc('crm_ocr_parse_execute_v1', {
      p_actor_uid: actorUid, p_preview_id: uuid(previewId),
    });
  }

  async previewUndo(data, actorUid) {
    if (!actorUid || data?.confirmed !== true) throw new Error('Human confirmation is required');
    return this.rpc('crm_ocr_parse_undo_preview_v1', {
      p_actor_uid: actorUid,
      p_idempotency_key: uuid(data.idempotencyKey),
      p_applied_command_id: uuid(data.commandId),
    });
  }
}

function id(value, label) {
  const result = String(value ?? '');
  if (!/^[1-9]\d*$/.test(result) || !Number.isSafeInteger(Number(result))) {
    throw new Error(`Invalid ${label} ID`);
  }
  return result;
}

function integer(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 2147483647) {
    throw new Error(`Invalid ${label} ID`);
  }
  return result;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid command ID');
  return value;
}

function boundedText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`Invalid ${label}`);
  }
  return value.trim();
}

function selectedFields(fields, selected) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
      !Array.isArray(selected) || selected.length < 1 || selected.length > ALLOWED_FIELDS.size) {
    throw new Error('Choose at least one OCR field to apply');
  }
  const result = {};
  const seen = new Set();
  for (const key of selected) {
    if (typeof key !== 'string' || !ALLOWED_FIELDS.has(key) || seen.has(key)) {
      throw new Error('OCR field is outside the approved scope');
    }
    seen.add(key);
    const value = fields[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`OCR field is empty: ${key}`);
    result[key] = value.trim();
  }
  return result;
}

module.exports = { OcrReviewService, selectedFields };
