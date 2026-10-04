'use strict';

const { disclose, refsForRows } = require('./test-data');
const KINDS = new Set(['action', 'commitment']);
const OPERATIONS = new Set(['create', 'edit', 'complete', 'cancel', 'reopen']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_COLUMNS = 'id,person_id,opportunity_id,interaction_id,activity_id,action_type,title,description,due_at,priority,status,source,completed_at,created_at,updated_at';
const COMMITMENT_COLUMNS = 'id,person_id,interaction_id,commitment_type,content,due_at,status,source,completed_at,created_at,updated_at';
const LIMIT = 50;
const RECENT_CLOSED = 10;

function idOf(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error('Invalid work item ID');
  }
  return text;
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function normalizeDraft(kind, operation, value) {
  if (!plain(value)) throw new Error('Invalid work item draft');
  if (!['create', 'edit'].includes(operation)) {
    if (Object.keys(value).length) throw new Error('Invalid work item transition');
    return {};
  }
  const keys = kind === 'action' ? ['title', 'description', 'dueAt', 'priority'] :
    ['content', 'dueAt', 'commitmentType'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid work item draft');
  const dueAt = value.dueAt == null || value.dueAt === '' ? null : value.dueAt;
  if (dueAt !== null && (typeof dueAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(dueAt) ||
      !Number.isFinite(Date.parse(dueAt)))) throw new Error('Invalid work item due date');
  if (kind === 'action') {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200 ||
        (value.description != null && (typeof value.description !== 'string' || value.description.length > 4000)) ||
        !['low','medium','high','urgent'].includes(value.priority)) {
      throw new Error('Invalid Action draft');
    }
    return { title:value.title.trim(), description:value.description || null,
      dueAt:dueAt ? new Date(dueAt).toISOString() : null, priority:value.priority };
  }
  if (typeof value.content !== 'string' || !value.content.trim() || value.content.trim().length > 4000 ||
      !['I_PROMISED','THEY_PROMISED','MUTUAL'].includes(value.commitmentType)) {
    throw new Error('Invalid Commitment draft');
  }
  return { content:value.content.trim(), dueAt:dueAt ? new Date(dueAt).toISOString() : null,
    commitmentType:value.commitmentType };
}
function decorate(rows, kind, names = new Map()) {
  return rows.map(row => ({...row, kind,
    person_name:names.get(String(row.person_id)) || row.person_name || null}));
}

class WorkItemService {
  constructor({ request, rpc, disclosure = disclose } = {}) {
    if (typeof request !== 'function' || typeof rpc !== 'function') {
      throw new Error('Authorized work item access is required');
    }
    this.request = request;
    this.rpc = rpc;
    this.disclosure = disclosure;
  }

  async listKind(table, columns, personId = null) {
    const scope = personId ? {person_id:`eq.${personId}`} : {};
    const activeStatus = table === 'actions' ? 'in.(open,in_progress)' : 'eq.open';
    const [open, closed] = await Promise.all([
      this.request(table,'GET',{select:columns,...scope,status:activeStatus,
        order:'due_at.asc.nullslast,id.desc',limit:LIMIT}),
      this.request(table,'GET',{select:columns,...scope,status:'in.(completed,cancelled)',
        order:'updated_at.desc,id.desc',limit:RECENT_CLOSED}),
    ]);
    return {rows:[...open,...closed],hasMore:open.length===LIMIT || closed.length===RECENT_CLOSED};
  }

  async listForPerson(personId) {
    const id = idOf(personId);
    const person = (await this.request('persons','GET',{
      select:'id,display_name',id:`eq.${id}`,deleted_at:'is.null',limit:1,
    }))[0];
    if (!person) throw new Error('Work item Person unavailable');
    const [actionSet, commitmentSet] = await Promise.all([
      this.listKind('actions',ACTION_COLUMNS,id),
      this.listKind('commitments',COMMITMENT_COLUMNS,id),
    ]);
    const actions=actionSet.rows, commitments=commitmentSet.rows;
    const rows = [...decorate(actions,'action'),...decorate(commitments,'commitment')];
    return {personId:Number(id),personName:person.display_name,rows,
      limit:LIMIT,recentClosedLimit:RECENT_CLOSED,
      hasMore:actionSet.hasMore || commitmentSet.hasMore,
      testData:await this.disclosure([
        ...refsForRows('persons',[person]),...refsForRows('actions',actions),
        ...refsForRows('commitments',commitments),
      ])};
  }

  async listForToday() {
    const [actionSet,commitmentSet] = await Promise.all([
      this.listKind('actions',ACTION_COLUMNS),
      this.listKind('commitments',COMMITMENT_COLUMNS),
    ]);
    const actions=actionSet.rows, commitments=commitmentSet.rows;
    const ids = [...new Set([...actions,...commitments].map(row => idOf(row.person_id)))];
    const persons = ids.length ? await this.request('persons','GET',{
      select:'id,display_name,deleted_at',id:`in.(${ids.join(',')})`,limit:LIMIT*2,
    }) : [];
    const names = new Map(persons.filter(row => !row.deleted_at)
      .map(row => [String(row.id),row.display_name]));
    const active = row => names.has(String(row.person_id));
    const rows = [...decorate(actions.filter(active),'action',names),
      ...decorate(commitments.filter(active),'commitment',names)];
    return {rows,limit:LIMIT,recentClosedLimit:RECENT_CLOSED,
      hasMore:actionSet.hasMore || commitmentSet.hasMore,
      asOf:new Date().toISOString(),testData:await this.disclosure([
        ...refsForRows('persons',persons.filter(row => !row.deleted_at)),
        ...refsForRows('actions',actions.filter(active)),
        ...refsForRows('commitments',commitments.filter(active)),
      ])};
  }

  async preview(data, actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || !plain(data) ||
        Object.keys(data).some(key => !['idempotencyKey','kind','operation','personId','itemId','draft'].includes(key)) ||
        !UUID.test(String(data.idempotencyKey || '')) || !KINDS.has(data.kind) ||
        !OPERATIONS.has(data.operation)) throw new Error('Invalid work item preview');
    const personId = Number(idOf(data.personId));
    const itemId = data.operation === 'create' ? null : Number(idOf(data.itemId));
    if (data.operation === 'create' && data.itemId != null) throw new Error('Invalid work item ID');
    const draft = normalizeDraft(data.kind,data.operation,data.draft || {});
    return this.rpc('crm_work_item_preview_v1',{
      p_actor_uid:actorUid,p_idempotency_key:data.idempotencyKey,
      p_kind:data.kind,p_operation:data.operation,p_person_id:personId,
      p_item_id:itemId,p_payload:draft,
    });
  }

  async execute(previewId, actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || !UUID.test(String(previewId || ''))) {
      throw new Error('Invalid work item execution');
    }
    return this.rpc('crm_work_item_execute_v1',{
      p_actor_uid:actorUid,p_preview_id:previewId,
    });
  }
}

module.exports = { WorkItemService, normalizeDraft, idOf };
