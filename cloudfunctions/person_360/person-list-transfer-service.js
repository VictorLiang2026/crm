'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { parsePersonName } = require('./person-service');

const TABLE = 'crm_person_list_transfer_commands';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_LIMITS = Object.freeze({
  display_name: 160, phone: 80, wechat: 160, gender: 16, birthday: 10,
  occupation: 120, organization: 160, education: 120, source: 160,
  hobbies: 8000, customer_stage: 32, sales_priority: 1, referral_priority: 1,
  marital_status: 40, first_contact_date: 10, notes: 8000,
});
const MERGE_FIELDS = new Set(['notes', 'hobbies']);
const FIELD_KEYS = Object.keys(FIELD_LIMITS);
const PRIORITIES = new Set(['A', 'B', 'C', 'D', 'E']);
const GENDERS = new Set(['男', '女', '未知']);
const STAGES = new Set(['新认识', '关系维护', '需求挖掘', '方案沟通', '成交推进', '转介绍经营']);
const NAME_KEY = /^[1-9][0-9]*$/;
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idOf = value => {
  const id = String(value ?? '');
  if (!NAME_KEY.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
};
const stringValue = value => value == null ? '' : String(value).trim();

function validateField(key, value) {
  if (!Object.hasOwn(FIELD_LIMITS, key)) throw new Error('FIELD_NOT_ALLOWED');
  const text = stringValue(value);
  if (text.length > FIELD_LIMITS[key]) throw new Error('FIELD_VALUE_TOO_LONG');
  if (!text) return '';
  if (['birthday', 'first_contact_date'].includes(key)) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== text) {
      throw new Error('INVALID_DATE');
    }
  }
  if (key === 'gender' && !GENDERS.has(text)) throw new Error('INVALID_GENDER');
  if (key === 'customer_stage' && !STAGES.has(text)) throw new Error('INVALID_CUSTOMER_STAGE');
  if (['sales_priority', 'referral_priority'].includes(key) && !PRIORITIES.has(text)) throw new Error('INVALID_PRIORITY');
  return text;
}

function rowValues(row) {
  if (!isObject(row) || !isObject(row.values)) throw new Error('INVALID_IMPORT_ROW');
  const result = {};
  for (const [key, value] of Object.entries(row.values)) {
    if (key === 'PersonID') { result.PersonID = stringValue(value); continue; }
    result[key] = validateField(key, value);
  }
  if (!result.display_name) throw new Error('NAME_REQUIRED');
  parsePersonName(result.display_name);
  if (result.PersonID && !NAME_KEY.test(result.PersonID)) throw new Error('INVALID_PERSON_ID');
  return result;
}

function evidenceFor(candidate, incoming) {
  const evidence = [];
  if (candidate.display_name === incoming.display_name) evidence.push('exact_name');
  if (incoming.phone && candidate.phone && incoming.phone === candidate.phone) evidence.push('exact_phone');
  if (incoming.wechat && candidate.wechat && incoming.wechat === candidate.wechat) evidence.push('exact_wechat');
  if (incoming.organization && candidate.organization && incoming.organization === candidate.organization) evidence.push('same_organization');
  if (incoming.occupation && candidate.occupation && incoming.occupation === candidate.occupation) evidence.push('same_occupation');
  const strong = evidence.includes('exact_phone') || evidence.includes('exact_wechat');
  return { evidence, suggested: strong || (candidate.display_name === incoming.display_name && evidence.includes('same_organization')) };
}

function chooseValue(current, incoming, policy, field) {
  if (incoming === '' || current === incoming) return { value: current, action: 'keep' };
  if (current === null || current === undefined || current === '') return { value: incoming, action: 'fill' };
  const override = policy.fieldOverrides?.[field];
  if (override === 'import' || (!override && policy.mode === 'import')) {
    return { value: incoming, action: 'replace' };
  }
  if ((override === 'merge' || (!override && policy.mergeText === true)) && MERGE_FIELDS.has(field)) {
    const parts = [String(current), String(incoming)].flatMap(value => value.split('；'));
    const merged = [...new Set(parts.map(value => value.trim()).filter(Boolean))].join('；');
    return { value: merged, action: merged === current ? 'keep' : 'merge' };
  }
  return { value: current, action: 'keep' };
}

class PersonListTransferService {
  constructor({ request, rpc, personService, now = () => new Date().toISOString() } = {}) {
    if (typeof request !== 'function' || typeof rpc !== 'function' || !personService) {
      throw new Error('INVALID_TRANSFER_CONFIG');
    }
    this.request = request;
    this.rpc = rpc;
    this.personService = personService;
    this.now = now;
  }

  assertActor(actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || actorUid.length > 128) throw new Error('UNAUTHORIZED');
    return actorUid.trim();
  }

  async getCommand(id, actorUid) {
    const rows = await this.request(TABLE, 'GET', {
      select: 'id,actor_uid,idempotency_key,input_hash,payload,preview,decisions,status,result,expires_at',
      id: `eq.${id}`, actor_uid: `eq.${actorUid}`, limit: '1',
    });
    return rows[0] || null;
  }

  async expireOld(actorUid) {
    await this.request(TABLE, 'PATCH', {
      actor_uid: `eq.${actorUid}`, expires_at: `lt.${this.now()}`, status: 'in.(preview,ready,partial,executing,completed)',
    }, { status: 'expired', payload: { rows: [] }, preview: { rows: [] }, decisions: {}, result: null, updated_at: this.now() });
  }

  async buildRow(row, index) {
    const values = rowValues(row);
    const parsed = parsePersonName(values.display_name);
    const resolution = await this.personService.resolveName(values.display_name);
    const candidates = resolution.candidates || [];
    let current = [];
    if (candidates.length) {
      current = await this.request('persons', 'GET', {
        select: 'id,display_name,name_key,phone,wechat,gender,birthday,occupation,organization,education,source,hobbies,customer_stage,sales_priority,referral_priority,marital_status,first_contact_date,notes,updated_at',
        id: `in.(${candidates.map(candidate => candidate.id).join(',')})`, deleted_at: 'is.null', limit: String(candidates.length + 1),
      });
    }
    const snapshots = current.map(person => {
      const original = candidates.find(candidate => candidate.id === String(person.id));
      const match = evidenceFor(person, values);
      return { ...person, organization: original?.organization ?? person.organization ?? null,
        occupation: original?.occupation ?? person.occupation ?? null, evidence: match.evidence,
        suggested: match.suggested };
    });
    if (values.PersonID) {
      const identified = snapshots.find(person => String(person.id) === values.PersonID);
      if (!identified || parsePersonName(identified.display_name).nameKey !== parsed.nameKey) {
        return { rowNumber: row.rowNumber || index + 2, values, baseName: parsed.nameKey,
          candidates: snapshots, status: 'blocked', reason: 'PERSON_ID_NAME_MISMATCH', current: null };
      }
    }
    if (resolution.hasMore) {
      return { rowNumber: row.rowNumber || index + 2, values, baseName: parsed.nameKey,
        candidates: snapshots, status: 'blocked', reason: 'TOO_MANY_NAME_MATCHES', current: null };
    }
    let duplicateOf = null;
    if (row.fingerprint) duplicateOf = String(row.fingerprint);
    return { rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : index + 2,
      values, baseName: parsed.nameKey, candidates: snapshots,
      status: candidates.length === 0 ? 'new' : 'needs_identity', current: null, duplicateOf,
      personId: values.PersonID || null };
  }

  async preview(data, actorValue) {
    const actorUid = this.assertActor(actorValue);
    if (!isObject(data) || !Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 1000 ||
        !UUID.test(String(data.idempotencyKey || ''))) throw new Error('INVALID_IMPORT_PREVIEW');
    const payload = { rows: data.rows.map((row, index) => ({ rowNumber: row?.rowNumber || index + 2, values: row?.values })) };
    const rowNumbers = payload.rows.map(row => row.rowNumber);
    if (rowNumbers.some(number => !Number.isInteger(number) || number < 2 || number > 100000) ||
        new Set(rowNumbers).size !== rowNumbers.length) throw new Error('INVALID_IMPORT_ROW_NUMBER');
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > 4 * 1024 * 1024) throw new Error('IMPORT_PAYLOAD_TOO_LARGE');
    const inputHash = hash(payload);
    await this.expireOld(actorUid);
    const existing = await this.request(TABLE, 'GET', {
      select: 'id,input_hash,status,expires_at', actor_uid: `eq.${actorUid}`,
      idempotency_key: `eq.${data.idempotencyKey}`, limit: '1',
    });
    if (existing[0]) {
      if (existing[0].input_hash !== inputHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
      const command = await this.getCommand(existing[0].id, actorUid);
      if (command?.status === 'expired' || Date.parse(command?.expires_at || 0) <= Date.parse(this.now())) throw new Error('PREVIEW_EXPIRED');
      if (command) return { previewId: command.id, status: command.status, preview: command.preview };
    }
    const built = [];
    for (let index = 0; index < payload.rows.length; index += 1) built.push(await this.buildRow(payload.rows[index], index));
    const seen = new Map();
    for (const row of built) {
      const rowHash = hash(row.values);
      if (seen.has(rowHash)) { row.status = 'duplicate'; row.duplicateOf = seen.get(rowHash); }
      else seen.set(rowHash, row.rowNumber);
    }
    const preview = { rows: built, counts: {
      new: built.filter(row => row.status === 'new').length,
      update: built.filter(row => row.status === 'needs_identity').length,
      blocked: built.filter(row => row.status === 'blocked').length,
      duplicate: built.filter(row => row.status === 'duplicate').length,
    } };
    if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > 4 * 1024 * 1024) throw new Error('IMPORT_PREVIEW_TOO_LARGE');
    const rows = await this.request(TABLE, 'POST', {}, {
      actor_uid: actorUid, idempotency_key: data.idempotencyKey, input_hash: inputHash,
      payload, preview, decisions: {}, status: 'preview',
      expires_at: new Date(Date.parse(this.now()) + 15 * 60 * 1000).toISOString(),
    });
    if (!rows[0]?.id) throw new Error('IMPORT_PREVIEW_SAVE_FAILED');
    return { previewId: String(rows[0].id), status: 'preview', preview };
  }

  async saveDecisions(data, actorValue) {
    const actorUid = this.assertActor(actorValue);
    if (!isObject(data) || !UUID.test(String(data.previewId || '')) || !Array.isArray(data.decisions) || data.decisions.length > 1000) {
      throw new Error('INVALID_IMPORT_DECISIONS');
    }
    const command = await this.getCommand(data.previewId, actorUid);
    if (!command || command.status !== 'preview' || Date.parse(command.expires_at) <= Date.parse(this.now())) throw new Error('PREVIEW_EXPIRED');
    const rows = new Map(command.preview.rows.map(row => [String(row.rowNumber), row]));
    const decisions = {};
    for (const entry of data.decisions) {
      const row = rows.get(String(entry?.rowNumber));
      if (!row || !isObject(entry.decision)) throw new Error('INVALID_IMPORT_DECISION');
      const decision = entry.decision;
      if (decision.kind === 'same') {
        const personId = idOf(decision.personId);
        if (!row.candidates.some(candidate => String(candidate.id) === personId)) throw new Error('PERSON_NOT_IN_PREVIEW');
        decisions[String(row.rowNumber)] = { kind: 'same', personId };
      } else if (decision.kind === 'different') {
        const parsed = parsePersonName(decision.displayName);
        if (parsed.nameKey !== row.baseName || !parsed.hasQualifier) throw new Error('QUALIFIER_REQUIRED');
        const plain = row.candidates.filter(candidate => !parsePersonName(candidate.display_name).hasQualifier);
        const rename = Array.isArray(decision.renameExisting) ? decision.renameExisting : [];
        if (plain.length !== rename.length) throw new Error('EXISTING_QUALIFIER_REQUIRED');
        const used = new Set(row.candidates.map(candidate => parsePersonName(candidate.display_name))
          .filter(candidate => candidate.hasQualifier).map(candidate => candidate.qualifierKey));
        if (used.has(parsed.qualifierKey)) throw new Error('QUALIFIER_CONFLICT');
        used.add(parsed.qualifierKey);
        const approvedRenames = rename.map(item => {
          const candidate = plain.find(value => String(value.id) === idOf(item?.personId));
          const name = parsePersonName(String(item?.displayName || ''));
          if (!candidate || name.nameKey !== row.baseName || !name.hasQualifier || used.has(name.qualifierKey)) throw new Error('QUALIFIER_CONFLICT');
          used.add(name.qualifierKey);
          return { personId: String(candidate.id), displayName: name.displayName };
        });
        decisions[String(row.rowNumber)] = { kind: 'different', displayName: parsed.displayName, renameExisting: approvedRenames };
      } else throw new Error('INVALID_IMPORT_DECISION');
    }
    if (command.preview.counts?.blocked > 0) throw new Error('IMPORT_HAS_BLOCKED_ROWS');
    const fieldPolicy = data.fieldPolicy || {};
    if (!isObject(fieldPolicy) || !['keep', 'import'].includes(fieldPolicy.mode || 'keep') ||
        !isObject(fieldPolicy.fieldOverrides || {}) || Object.entries(fieldPolicy.fieldOverrides || {}).some(([key, value]) =>
          !Object.hasOwn(FIELD_LIMITS, key) || !['keep', 'import', 'merge'].includes(value) || (value === 'merge' && !MERGE_FIELDS.has(key)))) {
      throw new Error('INVALID_FIELD_POLICY');
    }
    const allDecisions = { ...(command.decisions || {}), ...decisions,
      fieldPolicy: { mode: fieldPolicy.mode || 'keep', mergeText: fieldPolicy.mergeText === true,
        fieldOverrides: fieldPolicy.fieldOverrides || {} } };
    if (command.preview.rows.some(row => row.status === 'needs_identity' && !allDecisions[String(row.rowNumber)])) {
      throw new Error('IDENTITY_DECISION_REQUIRED');
    }
    const result = await this.request(TABLE, 'PATCH', { id: `eq.${command.id}`, actor_uid: `eq.${actorUid}`, status: 'eq.preview' },
      { decisions: allDecisions, status: 'ready', updated_at: this.now() });
    if (!result.length) throw new Error('PREVIEW_STALE');
    return { ok: true, previewId: command.id };
  }

  async currentPerson(personId) {
    const rows = await this.request('persons', 'GET', {
      select: 'id,display_name,name_key,phone,wechat,gender,birthday,occupation,organization,education,source,hobbies,customer_stage,sales_priority,referral_priority,marital_status,first_contact_date,notes,updated_at',
      id: `eq.${idOf(personId)}`, deleted_at: 'is.null', limit: '1',
    });
    return rows[0] || null;
  }

  async savePerson(person, fields, actorUid) {
    if (!Object.keys(fields).length) return { ok: true, updated: false };
    return this.rpc('crm_person_profile_save_v1', {
      p_actor_uid: actorUid, p_person_id: Number(person.id),
      p_person_expected_updated_at: person.updated_at,
      p_person_fields: fields, p_customer_id: null, p_customer_expected_updated_at: null,
      p_customer_fields: {}, p_recruit_id: null, p_recruit_expected_updated_at: null, p_recruit_fields: {},
    });
  }

  async execute(data, actorValue) {
    const actorUid = this.assertActor(actorValue);
    const previewId = String(data?.previewId || '');
    if (!UUID.test(previewId)) throw new Error('INVALID_PREVIEW_ID');
    const command = await this.getCommand(previewId, actorUid);
    if (!command) throw new Error('PREVIEW_NOT_FOUND');
    if (command.status === 'completed') {
      if (Date.parse(command.expires_at) <= Date.parse(this.now())) throw new Error('PREVIEW_EXPIRED');
      return { ...command.result, reused: true };
    }
    if (command.status === 'preview') throw new Error('CONFIRMATION_REQUIRED');
    if (!['ready', 'partial'].includes(command.status) || Date.parse(command.expires_at) <= Date.parse(this.now())) {
      throw new Error('PREVIEW_EXPIRED');
    }
    const claimed = await this.request(TABLE, 'PATCH', {
      id: `eq.${command.id}`, actor_uid: `eq.${actorUid}`, status: `eq.${command.status}`,
    }, { status: 'executing', updated_at: this.now() });
    if (!claimed.length) throw new Error('PREVIEW_STALE');
    const decisions = command.decisions || {};
    const policy = decisions.fieldPolicy || { mode: 'keep', mergeText: false, fieldOverrides: {} };
    const results = Array.isArray(command.result?.rows) ? [...command.result.rows] : command.preview.rows
      .filter(row => ['blocked', 'duplicate'].includes(row.status))
      .map(row => ({ rowNumber: row.rowNumber, status: row.status,
        code: row.reason || (row.status === 'duplicate' ? 'DUPLICATE_ROW' : 'PERSON_ID_NAME_MISMATCH') }));
    const retryable = new Set(results.filter(row => ['failed','needs_review'].includes(row.status)).map(row => Number(row.rowNumber)));
    const done = new Set(results.filter(row => !retryable.has(Number(row.rowNumber))).map(row => Number(row.rowNumber)));
    for (const row of command.preview.rows) {
      if (done.has(row.rowNumber) || ['blocked', 'duplicate'].includes(row.status)) continue;
      if (retryable.has(row.rowNumber)) {
        for (let index = results.length - 1; index >= 0; index -= 1) {
          if (Number(results[index].rowNumber) === row.rowNumber) results.splice(index, 1);
        }
      }
      const decision = decisions[String(row.rowNumber)];
      if (row.candidates.length && !decision) {
        results.push({ rowNumber: row.rowNumber, status: 'needs_review', code: 'IDENTITY_DECISION_REQUIRED' });
        continue;
      }
      try {
        const result = await this.executeRow(row, decision, policy, actorUid);
        results.push({ rowNumber: row.rowNumber, ...result });
      } catch (error) {
        results.push({ rowNumber: row.rowNumber, status: 'failed', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'ROW_EXECUTION_FAILED' });
      }
      await this.request(TABLE, 'PATCH', { id: `eq.${command.id}`, actor_uid: `eq.${actorUid}` },
        { result: { rows: results }, updated_at: this.now() });
    }
    const pending = results.some(row => row.status === 'failed' || row.status === 'needs_review');
    const finalStatus = pending ? 'partial' : 'completed';
    const response = { ok: !pending, previewId: command.id, rows: results,
      counts: { succeeded: results.filter(row => ['created', 'updated', 'unchanged'].includes(row.status)).length,
        failed: results.filter(row => ['failed', 'needs_review'].includes(row.status)).length,
        blocked: results.filter(row => row.status === 'blocked').length,
        skipped: results.filter(row => row.status === 'duplicate').length } };
    await this.request(TABLE, 'PATCH', { id: `eq.${command.id}`, actor_uid: `eq.${actorUid}` },
      { status: finalStatus, result: response, updated_at: this.now(), executed_at: this.now(),
        ...(finalStatus === 'completed' ? { payload: { rows: [] }, preview: { rows: [] }, decisions: {} } : {}) });
    return response;
  }

  async executeRow(row, decision, policy, actorUid) {
    const name = decision?.kind === 'different' ? decision.displayName : row.values.display_name;
    const identity = await this.personService.resolveName(name);
    let target = null;
    if (decision?.kind === 'same') {
      target = await this.currentPerson(decision.personId);
      if (!target || parsePersonName(target.display_name).nameKey !== row.baseName ||
          !identity.candidates.some(candidate => candidate.id === String(target.id))) throw new Error('PREVIEW_STALE');
      const previous = row.candidates.find(candidate => String(candidate.id) === String(target.id));
      if (!previous || previous.updated_at !== target.updated_at) throw new Error('PREVIEW_STALE');
    } else {
      if (decision?.kind === 'different') {
        const priorIds = new Set(row.candidates.map(candidate => String(candidate.id)));
        if (identity.candidates.length !== priorIds.size || identity.candidates.some(candidate => !priorIds.has(candidate.id))) {
          throw new Error('PREVIEW_STALE');
        }
        for (const before of row.candidates) {
          const current = await this.currentPerson(before.id);
          if (!current || current.updated_at !== before.updated_at || current.display_name !== before.display_name) {
            throw new Error('PREVIEW_STALE');
          }
        }
        const renameExisting = [];
        for (const rename of decision.renameExisting) {
          const current = await this.currentPerson(rename.personId);
          const before = row.candidates.find(candidate => String(candidate.id) === String(rename.personId));
          if (!current || !before || current.updated_at !== before.updated_at || current.display_name !== before.display_name) throw new Error('PREVIEW_STALE');
          renameExisting.push({ personId: String(current.id), expectedUpdatedAt: current.updated_at, displayName: rename.displayName });
        }
        const parsed = parsePersonName(name);
        const fields = { ...row.values, display_name: name, name_key: parsed.nameKey };
        delete fields.PersonID;
        const created = await this.rpc('crm_person_list_transfer_create_v1', {
          p_actor_uid: actorUid, p_existing: renameExisting, p_new_person: fields,
        });
        if (created?.conflict || created?.code === 'PREVIEW_STALE') throw new Error('PREVIEW_STALE');
        if (!created?.ok || !created.personId) throw new Error('PERSON_CONFLICT');
        return { status: 'created', personId: String(created.personId), displayName: name };
      }
      const duplicateName = await this.request('persons','GET',{
        select:'id',display_name:`eq.${name}`,deleted_at:'is.null',limit:'1',
      });
      if (duplicateName.length) throw new Error('NAME_ALREADY_EXISTS');
      const parsed = parsePersonName(name);
      const fields = { ...row.values, display_name: name, name_key: parsed.nameKey };
      delete fields.PersonID;
      const created = await this.personService.createPerson(fields);
      return { status: 'created', personId: created.id, displayName: name };
    }
    const updates = {};
    for (const field of FIELD_KEYS) {
      const incoming = row.values[field];
      if (incoming === undefined) continue;
      const chosen = chooseValue(target[field], incoming, policy, field);
      if (chosen.value !== target[field]) updates[field] = chosen.value;
    }
    if (!Object.keys(updates).length) return { status: 'unchanged', personId: String(target.id), displayName: target.display_name };
    const saved = await this.savePerson(target, updates, actorUid);
    if (!saved?.ok) throw new Error('PERSON_CONFLICT');
    return { status: 'updated', personId: String(target.id), displayName: updates.display_name || target.display_name };
  }

  async exportPeople(data, actorValue) {
    this.assertActor(actorValue);
    const afterId = data?.afterId == null || data.afterId === '' ? null : idOf(data.afterId);
    const allowed = new Set(['phone','wechat','gender','birthday','occupation','organization','education','source','hobbies',
      'customer_stage','sales_priority','referral_priority','marital_status','first_contact_date','notes']);
    const fields = Array.isArray(data?.fields) ? [...new Set(data.fields.map(String).filter(field => allowed.has(field)))] : [];
    const select = ['id','display_name',...fields].join(',');
    const rows = await this.request('persons','GET',{select,deleted_at:'is.null',order:'id.asc',limit:'500',
      ...(afterId ? { id:`gt.${afterId}` } : {})});
    const output = rows.map(row => ({ PersonID: String(row.id), display_name: row.display_name,
      ...Object.fromEntries(fields.map(field => [field, row[field] ?? ''])) }));
    return { columns: ['PersonID','display_name',...fields], rows: output, count: output.length,
      hasMore: rows.length === 500, nextAfterId: rows.length ? String(rows[rows.length - 1].id) : afterId };
  }
}

module.exports = { PersonListTransferService, FIELD_LIMITS, MERGE_FIELDS, validateField, chooseValue, evidenceFor };
