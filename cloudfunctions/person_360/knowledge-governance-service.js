'use strict';

const TYPES = new Set(['evidence', 'case', 'story']);
const STATES = new Set(['draft', 'verified', 'superseded', 'invalidated']);
const CATEGORIES = new Set(['on_sale_product','existing_service','recruitment_policy','industry_development',
  'marketing_activity','legal_tax','health_wealth_sharing','top_performer_sharing','customer_case','recruitment_case',
  'conversation_strategy','objection_handling','company_information','other']);
const clip = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positive = value => /^[1-9]\d*$/.test(String(value || '')) && Number.isSafeInteger(Number(value));
const publishedToday = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

class KnowledgeGovernanceService {
  constructor({ request, rpc, now = () => new Date() }) {
    if (typeof request !== 'function' || typeof rpc !== 'function') throw new Error('Governance database access required');
    this.request = request;
    this.rpc = rpc;
    this.now = now;
  }

  async list() {
    const [knowledge, playbooks] = await Promise.all([
      this.request('knowledge_items', 'GET', { select: '*', deleted_at:'is.null', order: 'updated_at.desc,id.desc', limit: 200 }),
      this.request('playbooks', 'GET', { select: '*', deleted_at:'is.null', order: 'updated_at.desc,id.desc', limit: 200 }),
    ]);
    return { knowledge, playbooks };
  }

  async save(data, uid) {
    if (!uid || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid governance content');
    const isPlaybook = data.table === 'playbooks';
    const table = isPlaybook ? 'playbooks' : 'knowledge_items';
    const id = data.id == null ? null : String(data.id);
    if (id && !positive(id)) throw new Error('Invalid governance content');
    const expected = id ? String(data.expectedUpdatedAt || '') : '';
    let current = null;
    if (id) {
      current = (await this.request(table, 'GET', { select: '*', id: `eq.${id}`, deleted_at:'is.null', limit: 1 }))[0];
      if (!current || !['draft','verified','invalidated'].includes(current.lifecycle_status) || current.updated_at !== expected) {
        throw new Error('Content changed or is no longer editable');
      }
    }
    const parentId = !id && positive(data.supersedesId) ? String(data.supersedesId) : null;
    const parent = parentId ? (await this.request(table, 'GET', { select: 'id,lifecycle_status,version_no,item_type,scenario',
      id: `eq.${parentId}`, limit: 1 }))[0] : null;
    if (parentId && (!parent || parent.lifecycle_status !== 'verified' ||
        (isPlaybook ? parent.scenario !== clip(data.scenario, 160) : parent.item_type !== (TYPES.has(data.item_type) ? data.item_type : 'evidence')))) {
      throw new Error('Verified revision parent is required');
    }
    const payload = isPlaybook ? {
      scenario: clip(data.scenario, 160), objection: clip(data.objection, 500),
      possible_underlying_reasons: Array.isArray(data.possible_underlying_reasons) ? data.possible_underlying_reasons.slice(0, 10) : [],
      clarifying_questions: Array.isArray(data.clarifying_questions) ? data.clarifying_questions.slice(0, 10) : [],
      response_logic: clip(data.response_logic, 4000), evidence_refs: [], case_refs: [], story_refs: [],
      do_not_say: Array.isArray(data.do_not_say) ? data.do_not_say.slice(0, 10) : [],
      next_objective: clip(data.next_objective, 500), source: 'Knowledge Library',
      confidence: data.confidence == null ? null : Number(data.confidence),
      valid_from: null, valid_to: null,
      metadata: { ...(current?.metadata&&typeof current.metadata==='object'?current.metadata:{}),
        ...(data.metadata&&typeof data.metadata==='object'?data.metadata:{}),
        published_at: data.publishedAt || current?.metadata?.published_at || publishedToday(this.now()),
        categories: data.categories||data.metadata?.categories||['conversation_strategy'], revisionNote: clip(data.revisionNote, 500) }, updated_by: uid,
    } : {
      item_type: TYPES.has(data.item_type) ? data.item_type : 'evidence',
      source: clip(data.source, 500), source_date: null,
      valid_from: null, valid_to: null,
      verified: false, confidence: data.confidence == null ? null : Number(data.confidence),
      content: clip(data.content, 8000), metadata: {
        ...(current?.metadata&&typeof current.metadata==='object'?current.metadata:{}),
        categories: data.categories||data.metadata?.categories||['other'],
        person: { schema: 'public', table: 'persons', id: positive(data.personId) ? Number(data.personId) : null },
        published_at: data.publishedAt || current?.metadata?.published_at || publishedToday(this.now()),
        revisionNote: clip(data.revisionNote, 500),
      }, updated_by: uid,
    };
    if (!Array.isArray(payload.metadata.categories) || !payload.metadata.categories.length ||
        payload.metadata.categories.some(category => !CATEGORIES.has(category))) throw new Error('Select at least one valid category');
    const mainText = isPlaybook ? [payload.scenario, payload.response_logic] : [payload.source, payload.content];
    if (mainText.some(v => !v)) throw new Error('Source, title and content are required');
    if (!Number.isFinite(payload.confidence) || payload.confidence < 0 || payload.confidence > 1) throw new Error('Invalid confidence');
    if (id) {
      if (table === 'knowledge_items') payload.verified = true;
      payload.lifecycle_status = 'verified';
      const rows = await this.request(table, 'PATCH', { id: `eq.${id}`, updated_at: `eq.${expected}`, deleted_at:'is.null' }, payload);
      if (rows.length !== 1) throw new Error('Content changed; reload before editing');
      return rows[0];
    }
    payload.created_by = uid;
    payload.lifecycle_status = 'draft';
    if (parent) { payload.supersedes_id = Number(parent.id); payload.version_no = Number(parent.version_no || 1) + 1; }
    const rows = await this.request(table, 'POST', {}, payload);
    if (!rows[0]) throw new Error('Content could not be saved');
    await this.review({ table, id: rows[0].id, action: 'verify', expectedUpdatedAt: rows[0].updated_at }, uid);
    return (await this.request(table, 'GET', { select:'*', id:`eq.${rows[0].id}`, deleted_at:'is.null', limit:1 }))[0] || rows[0];
  }

  async review(data, uid) {
    if (!uid || !positive(data?.id) || !['knowledge_items', 'playbooks'].includes(data?.table) ||
        !['verify', 'invalidate'].includes(data?.action) || !data.expectedUpdatedAt) throw new Error('Invalid review request');
    return this.rpc('crm_knowledge_review_v1', {
      p_table: data.table, p_id: Number(data.id), p_action: data.action,
      p_actor_uid: uid, p_expected_updated_at: data.expectedUpdatedAt,
    });
  }

  async createFixtures(uid) {
    if (!uid) throw new Error('Login required');
    const refs = await this.request('crm_test_records', 'GET', {
      select: 'record_id,visible_label', record_table: 'eq.persons', origin: 'eq.initial',
      batch_key: 'eq.crm_test_main_v1', limit: 50,
    });
    const person = refs.find(row => row.record_id && String(row.visible_label || '').includes('勿联系'));
    if (!person) throw new Error('Tracked fictional Person required');
    const [existingKnowledge, existingPlaybooks] = await Promise.all([
      this.request('knowledge_items', 'GET', { select: 'id,lifecycle_status,updated_at',
        source: 'eq.PC22 系统合成回归样例；未用于客户决策', limit: 3 }),
      this.request('playbooks', 'GET', { select: 'id,lifecycle_status,updated_at',
        scenario: 'eq.【系统测试·勿联系】PC22 回归样例', limit: 2 }),
    ]);
    if (existingKnowledge.length || existingPlaybooks.length) return {
      alreadyPresent: true, created: [...existingKnowledge.map(row => row.id), ...existingPlaybooks.map(row => row.id)],
      personId: person.record_id, marker: '【系统测试·勿联系】',
    };
    const core = { source: 'PC22 系统合成回归样例；未用于客户决策', confidence: 0.82,
      content: '【系统测试·勿联系】PC22 合成知识治理样例。禁止用于客户沟通。',
      metadata: { person: { schema: 'public', table: 'persons', id: Number(person.record_id) }, testOnly: true },
      created_by: uid, updated_by: uid };
    const good = (await this.request('knowledge_items', 'POST', {}, { ...core, item_type: 'evidence', verified: false,
      lifecycle_status: 'draft', source_date: this.now().toISOString().slice(0, 10), confidence: 0.91 }))[0];
    const pending = (await this.request('knowledge_items', 'POST', {}, { ...core, item_type: 'evidence', verified: false,
      lifecycle_status: 'draft', confidence: 0.35 }))[0];
    const playbook = (await this.request('playbooks', 'POST', {}, { scenario: '【系统测试·勿联系】PC22 回归样例',
      objection: '担心理赔服务', possible_underlying_reasons: [], clarifying_questions: ['您最关心哪类服务？'],
      response_logic: '先核实合同条款和服务来源。', evidence_refs: [good.id], case_refs: [], story_refs: [],
      do_not_say: ['保证理赔'], next_objective: '确认需求', source: core.source, confidence: 0.91,
      valid_from: this.now().toISOString().slice(0, 10), lifecycle_status: 'draft', created_by: uid,
      updated_by: uid, metadata: { person: { schema: 'public', table: 'persons', id: Number(person.record_id) }, testOnly: true } }))[0];
    await this.review({ table: 'knowledge_items', id: good.id, action: 'verify', expectedUpdatedAt: good.updated_at }, uid);
    await this.review({ table: 'playbooks', id: playbook.id, action: 'verify', expectedUpdatedAt: playbook.updated_at }, uid);
    return { created: [good?.id, pending?.id, playbook?.id], personId: person.record_id, marker: '【系统测试·勿联系】' };
  }
}

module.exports = { KnowledgeGovernanceService };
