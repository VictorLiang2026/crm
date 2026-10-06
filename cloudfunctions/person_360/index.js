/** Person 360 family context. The API key is server-only and never returned. */
'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { parsePersonName, PersonService } = require('./person-service');
const { InteractionService } = require('./interaction-service');
const { ActivityInteractionService } = require('./activity-interaction-service');
const { ActivityReviewWorkflowService } = require('./activity-review-workflow-service');
const { CommitmentService } = require('./commitment-service');
const { WorkItemService } = require('./work-item-service');
const { OpportunityWorkflowService } = require('./opportunity-workflow-service');
const { disclose, refsForRows } = require('./test-data');
const { InsuranceContextService } = require('./insurance-context-service');
const { ParticipantService } = require('./participant-service');
const { SpeakerProfileService } = require('./speaker-profile-service');
const { RelationshipDecayService } = require('./relationship-decay-service');
const { getCustomerProfile } = require('./customer-profile-service');
const { PersonInsightsService } = require('./person-insights-service');
const { MeetingPrepContextBuilder } = require('./meeting-prep-context');

const app = cloudbase.init({ env: process.env.TCB_ENV });
const LEGACY_INTERACTION_TABLES = new Set([
  'followups', 'customers', 'recruit_candidates', 'recruit_followups',
  'activity_participants', 'activity_speakers', 'activities',
]);
const INSURANCE_READ_TABLES = new Set([
  'products', 'policy_review_reports', 'ocr_records', 'photos', 'actions',
]);
const RELATIONSHIP_READ_TABLES = new Set(['context_items', 'person_roles', 'relationships']);
const RECRUIT_READ_TABLES = new Set([
  'v_recruit_candidates_person_only', 'v_recruit_candidates_person_only_trash',
  'recruit_milestones',
]);
const OPPORTUNITY_READ_TABLES = new Set([
  'opportunity_candidates','outcomes','crm_opportunity_action_links',
  'crm_test_batches','crm_test_records',
]);
const AI_AUDIT_READ_TABLES = new Set(['ai_tasks', 'ai_results']);
const TABLES = new Set([
  'persons', 'households', 'household_members', 'interactions', 'commitments',
  'opportunities',
  ...INSURANCE_READ_TABLES,
  ...RELATIONSHIP_READ_TABLES,
  ...RECRUIT_READ_TABLES,
  ...OPPORTUNITY_READ_TABLES,
  ...AI_AUDIT_READ_TABLES,
  ...LEGACY_INTERACTION_TABLES,
]);
const ROLES = new Set(['spouse', 'child', 'parent', 'sibling', 'other']);
const OPPORTUNITY_TYPES = new Set([
  'insurance', 'recruit', 'referral', 'activity', 'speaker',
  'partnership', 'service', 'relationship',
]);
const OPPORTUNITY_STATUSES = new Set(['发现', '沟通', '方案', '成交', '关闭']);
const REFERRAL_STATUSES = new Set(['潜在线索', '已介绍', '已联系', '已建立关系', '成交', '关闭']);

function idOf(value) {
  const s = String(value ?? '');
  if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error('Invalid Person ID');
  return s;
}

function directoryPage(event) {
  const page = Number(event?.page ?? 1);
  const pageSize = Number(event?.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1 || page > 1000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new Error('Invalid directory page');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

async function pgRequest(table, method, filters = {}, body) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
  if (LEGACY_INTERACTION_TABLES.has(table) && method !== 'GET' &&
      !(table === 'activity_participants' && method === 'POST') &&
      !(table === 'activity_speakers' && (method === 'POST' || method === 'PATCH'))) {
    throw new Error('Invalid source operation');
  }
  if (INSURANCE_READ_TABLES.has(table) && method !== 'GET') throw new Error('Invalid source operation');
  if (RELATIONSHIP_READ_TABLES.has(table) && method !== 'GET') throw new Error('Invalid source operation');
  if (RECRUIT_READ_TABLES.has(table) && method !== 'GET') throw new Error('Invalid source operation');
  if (OPPORTUNITY_READ_TABLES.has(table) && method !== 'GET') throw new Error('Invalid source operation');
  if (table === 'commitments' && method !== 'GET') throw new Error('Invalid source operation');
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_PERSON360_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Person 360 is not configured');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Accept-Profile': 'public',
        'Content-Profile': 'public',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    const payload = await response.text();
    const rows = payload ? JSON.parse(payload) : [];
    if (!Array.isArray(rows)) throw new Error('Unexpected database response');
    return rows;
  } finally { clearTimeout(timeout); }
}

async function pgRpc(name, body) {
  if (!new Set(['quick_capture_v2_commit', 'person_directory_page_v1',
    'person_identity_preview_v1', 'person_identity_execute_v1',
    'crm_person_only_recruit_delete_v1', 'crm_work_item_preview_v1',
    'crm_work_item_execute_v1', 'crm_opportunity_preview_v1',
    'crm_opportunity_execute_v1','crm_activity_review_preview_v1',
    'crm_activity_review_execute_v1']).has(name)) throw new Error('Invalid RPC');
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_PERSON360_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Person 360 is not configured');
  const url = `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/${name}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Accept-Profile': 'public',
        'Content-Profile': 'public',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      const message = typeof problem?.message === 'string' ? problem.message : '';
      if (/^(Invalid |Selected Person|Same-name|Deleted identity|Customer |Preview |Identity candidates|Active Person|Person-only recruit|Test account|Test parent|Idempotency key|Unauthorized|Speaker profile|Work item|Action |Commitment |Opportunity |Person changed|Activity |Outcome )/.test(message)) {
        throw new Error(message);
      }
      throw new Error(`Database request failed (${response.status})`);
    }
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Unexpected database response');
    return result;
  } finally { clearTimeout(timeout); }
}

async function listActivityData(event) {
  const activityId = String(event?.activityId || '').trim();
  if (!/^[1-9][0-9]*$/.test(activityId)) throw new Error('Invalid activity identity');
  const id = activityId;

  // 互动记录
  const interactions = await pgRequest('interactions', 'GET', {
    activity_id: `eq.${id}`,
    order: 'interaction_at.desc',
  });
  const personIds = [...new Set(interactions.map(r => r.person_id).filter(Boolean))];
  const personMap = {};
  if (personIds.length) {
    const persons = await pgRequest('persons', 'GET', {
      id: `in.(${personIds.join(',')})`,
      select: 'id,display_name',
    });
    (persons || []).forEach(p => { personMap[p.id] = p.display_name; });
  }
  const INTERACTION_LABELS = {
    invitation: '邀约', conversation: '实质沟通',
    speaker_cooperation: '嘉宾合作', post_event_followup: '活动后跟进',
  };
  const rows = (interactions || []).map(r => ({
    id: r.id, personId: r.person_id, personName: personMap[r.person_id] || `Person #${r.person_id}`,
    type: INTERACTION_LABELS[r.interaction_type] || r.interaction_type,
    channel: r.channel, summary: r.summary, importance: r.importance,
    interactionAt: r.interaction_at, sourceType: r.source_type, sourceId: r.source_id,
  }));

  // 机会候选：最近一次 activity_review 的 ai_results
  let opportunityCandidates = [];
  const tasks = await pgRequest('ai_tasks', 'GET', {
    subject_type: 'eq.activity', subject_id: `eq.${id}`,
    task_type: 'eq.activity_review', status: 'eq.completed',
    order: 'created_at.desc', limit: 1,
  });
  if (tasks && tasks.length) {
    const results = await pgRequest('ai_results', 'GET', {
      task_id: `eq.${tasks[0].id}`, limit: 1,
    });
    if (results && results.length) {
      const cands = results[0].result_json?.opportunityCandidates || [];
      opportunityCandidates = cands.map(c => ({
        personId: c.personId, personName: personMap[c.personId] || `Person #${c.personId}`,
        opportunityType: c.opportunityType, reason: c.reason,
        nextAction: c.nextAction, sourceRefs: c.sourceRefs,
      }));
    }
  }

  return { activityId: id, interactions: rows, opportunityCandidates };
}

function createService({ request = pgRequest, rpc = pgRpc, disclosure = disclose } = {}) {
  const findPerson = async id => one(await request('persons', 'GET', {
    select: 'id,display_name,legacy_customer_id,occupation,organization',
    id: `eq.${idOf(id)}`, deleted_at: 'is.null', limit: 1,
  }));
  const findHousehold = async anchorId => one(await request('households', 'GET', {
    select: 'id,anchor_person_id,important_facts',
    anchor_person_id: `eq.${idOf(anchorId)}`, deleted_at: 'is.null', limit: 1,
  }));

  async function get(personId) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const household = await findHousehold(person.id);
    if (!household) return { person, household: null, members: [] };
    const members = await request('household_members', 'GET', {
      select: 'id,person_id,relationship_to_anchor,confirmed_at',
      household_id: `eq.${idOf(household.id)}`, deleted_at: 'is.null', order: 'id.asc', limit: 50,
    });
    const ids = members.map(member => idOf(member.person_id));
    const people = ids.length ? await request('persons', 'GET', {
      select: 'id,display_name,legacy_customer_id',
      id: `in.(${ids.join(',')})`, deleted_at: 'is.null', limit: 50,
    }) : [];
    const names = new Map(people.map(item => [String(item.id), item]));
    return {
      person, household,
      members: members.map(member => ({ ...member, person: names.get(String(member.person_id)) || null })),
    };
  }

  async function lookupCustomer(customerId) {
    const person = one(await request('persons', 'GET', {
      select: 'id,display_name', legacy_customer_id: `eq.${idOf(customerId)}`,
      deleted_at: 'is.null', limit: 1,
    }));
    if (!person) throw new Error('This customer has no Person record yet');
    return { personId: String(person.id) };
  }

  async function listPeople(event = {}) {
    const { page, pageSize } = directoryPage(event);
    const keyword = String(event.keyword || '').trim();
    if (keyword.length > 40 || (keyword && !/^[\p{L}\p{N} （）()【】·.-]+$/u.test(keyword))) {
      throw new Error('Invalid directory keyword');
    }
    const sortField = String(event.sortField || 'id');
    const sortDir = String(event.sortDir || 'desc');
    if (!['id', 'display_name', 'updated_at', 'sales_priority', 'customer_stage',
      'latest_followup_date', 'next_followup_date'].includes(sortField) || !['asc', 'desc'].includes(sortDir)) {
      throw new Error('Invalid directory sort');
    }
    return rpc('person_directory_page_v1', {
      p_page: page, p_page_size: pageSize, p_keyword: keyword,
      p_sort_field: sortField, p_sort_dir: sortDir,
    });
  }

  async function resolveIdentity(name) {
    const resolved = await new PersonService({ request }).resolveName(name);
    const deleted = await request('persons', 'GET', {
      select: 'id', display_name: `eq.${resolved.displayName}`,
      deleted_at: 'not.is.null', limit: 1,
    });
    return { ...resolved, deletedIdentity: deleted.length > 0 };
  }

  async function previewIdentity(data, uid) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid identity command');
    const kind = String(data.kind || '');
    if (!['person', 'customer', 'recruit', 'speaker', 'capture'].includes(kind)) throw new Error('Invalid identity command');
    const key = String(data.idempotencyKey || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new Error('Invalid idempotency key');
    }
    const selected = data.personId == null ? null : idOf(data.personId);
    let name = String(data.displayName || '');
    if (selected && !name) {
      const person = await findPerson(selected);
      if (!person) throw new Error('Selected Person not found');
      name = person.display_name;
    }
    const resolution = await resolveIdentity(name);
    if (selected) {
      const person = await findPerson(selected);
      if (!person || person.display_name !== resolution.displayName) {
        throw new Error('Selected Person changed; resolve identity again');
      }
      if (kind === 'person' && !resolution.candidates.some(c => c.id === selected)) {
        throw new Error('Selected Person is outside the reviewed candidates');
      }
    } else {
      if (kind === 'customer' || kind === 'recruit') throw new Error('Selected Person is required');
      if (resolution.hasMore || resolution.deletedIdentity ||
          !['available', 'confirm_new_qualified'].includes(resolution.status)) {
        throw new Error('Identity candidates need manual review');
      }
    }
    const payload = {
      display_name: resolution.displayName, name_key: resolution.nameKey,
      ...(selected ? { person_id: selected } : {}),
      occupation: String(data.occupation || '').trim().slice(0, 120),
      organization: String(data.organization || '').trim().slice(0, 120),
      education: String(data.education || '').trim().slice(0, 120),
      source: kind === 'capture' ? '快速记录' : '人工新增',
    };
    if (kind === 'capture') {
      const note = String(data.note || '').trim();
      if (!note || note.length > 10000) throw new Error('Invalid quick capture note');
      payload.note = note;
      payload.summary = String(data.summary || note).trim().slice(0, 2000);
      payload.interaction_at = new Date().toISOString();
      payload.customer = data.customer === true;
      payload.speaker = data.speaker === true;
      if (data.speakerId != null) payload.speaker_id = idOf(data.speakerId);
      if (data.nextDate != null && data.nextDate !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.nextDate))) throw new Error('Invalid next contact date');
        payload.next_contact_date = String(data.nextDate);
      }
    }
    return rpc('person_identity_preview_v1', {
      p_actor_uid: uid, p_idempotency_key: key, p_kind: kind, p_payload: payload,
    });
  }

  async function executeIdentity(data, uid) {
    const previewId = String(data?.previewId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewId)) {
      throw new Error('Invalid preview ID');
    }
    return rpc('person_identity_execute_v1', { p_actor_uid: uid, p_preview_id: previewId });
  }

  async function listOpportunityDirectory(event = {}) {
    const { page, pageSize, offset } = directoryPage(event);
    const rows = await request('opportunities', 'GET', {
      select: 'id,person_id,customer_id,opportunity_type,status,next_action,updated_at',
      deleted_at: 'is.null', order: 'updated_at.desc,id.desc',
      limit: pageSize + 1, offset,
    });
    const pageRows = rows.slice(0, pageSize);
    const personIds = [...new Set(pageRows.map(row => row.person_id).filter(Boolean).map(idOf))];
    const customerIds = [...new Set(pageRows.map(row => row.customer_id).filter(Boolean).map(idOf))];
    const [linked, legacy] = await Promise.all([
      personIds.length ? request('persons', 'GET', {
        select: 'id,display_name,legacy_customer_id', id: `in.(${personIds.join(',')})`,
        deleted_at: 'is.null', limit: 50,
      }) : [],
      customerIds.length ? request('persons', 'GET', {
        select: 'id,display_name,legacy_customer_id', legacy_customer_id: `in.(${customerIds.join(',')})`,
        deleted_at: 'is.null', limit: 50,
      }) : [],
    ]);
    const byPerson = new Map(linked.map(person => [String(person.id), person]));
    const byCustomer = new Map(legacy.map(person => [String(person.legacy_customer_id), person]));
    return { rows: pageRows.map(row => ({ ...row,
      person: byPerson.get(String(row.person_id)) || byCustomer.get(String(row.customer_id)) || null,
    })), page, pageSize, hasMore: rows.length > pageSize };
  }

  async function listPersonOnlyRecruits() {
    const rows = await request('v_recruit_candidates_person_only', 'GET', {
      select: '*', order: 'updated_at.desc,candidate_id.desc', limit: 1000,
    });
    return { rows, total: rows.length, personOnly: true };
  }

  async function getPersonOnlyRecruit(id) {
    const candidate = one(await request('v_recruit_candidates_person_only', 'GET', {
      select: '*', candidate_id: `eq.${idOf(id)}`, limit: 1,
    }));
    if (!candidate) return { error: 'not found' };
    const milestones = await request('recruit_milestones', 'GET', {
      select: '*', candidate_id: `eq.${idOf(id)}`, order: 'happened_at.desc,id.desc', limit: 100,
    });
    return { candidate, milestones };
  }

  async function listPersonOnlyRecruitTrash() {
    const rows = await request('v_recruit_candidates_person_only_trash', 'GET', {
      select: '*', order: 'candidate_deleted_at.desc,candidate_id.desc', limit: 1000,
    });
    const counts = {};
    if (rows.length) {
      const ids = rows.map(row => idOf(row.candidate_id));
      const roots = await request('recruit_candidates', 'GET', {
        select: 'id,delete_batch_id', id: `in.(${ids.join(',')})`, limit: 1000,
      });
      const batches = new Map(roots.map(row => [String(row.id), row.delete_batch_id || null]));
      for (const row of rows) {
        const id = String(row.candidate_id);
        counts[id] = { followups: 0 };
        row.legacy_delete = !batches.get(id);
      }
      const followups = await request('recruit_followups', 'GET', {
        select: 'candidate_id,delete_batch_id', candidate_id: `in.(${ids.join(',')})`,
        deleted_at: 'not.is.null', limit: 1000,
      });
      for (const followup of followups) {
        const id = String(followup.candidate_id);
        if (batches.get(id) && followup.delete_batch_id === batches.get(id)) {
          counts[id].followups++;
        }
      }
    }
    return { rows, total: rows.length, counts, personOnly: true };
  }

  async function changePersonOnlyRecruit(action, ids, uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('Unauthorized Person-only recruit action');
    if (!['remove', 'restore'].includes(action) || !Array.isArray(ids) ||
        ids.length < 1 || ids.length > 100 || (action === 'remove' && ids.length !== 1)) {
      throw new Error('Invalid Person-only recruit action');
    }
    const cleanIds = ids.map(idOf);
    if (new Set(cleanIds).size !== cleanIds.length) throw new Error('Invalid Person-only recruit IDs');
    return rpc('crm_person_only_recruit_delete_v1', {
      p_actor_uid: uid, p_action: action, p_ids: cleanIds.map(Number),
    });
  }

  async function listOpportunities(personId) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const own = await request('opportunities', 'GET', {
      select: '*', person_id: `eq.${idOf(person.id)}`,
      deleted_at: 'is.null', order: 'updated_at.desc', limit: 100,
    });
    const legacy = person.legacy_customer_id == null ? [] : await request('opportunities', 'GET', {
      select: '*', customer_id: `eq.${idOf(person.legacy_customer_id)}`,
      deleted_at: 'is.null', order: 'updated_at.desc', limit: 100,
    });
    const byId = new Map();
    for (const row of own.concat(legacy)) byId.set(String(row.id), row);
    const rows = [...byId.values()].sort((a, b) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return { rows, testData: await disclose(refsForRows('opportunities', rows)) };
  }

  async function listRecruitContext(personId) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const candidates = await request('recruit_candidates', 'GET', {
      select: 'id,person_id,stage,motivation,concerns,potential_score,career_plan,next_action,next_action_date',
      person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null',
      order: 'updated_at.desc,id.desc', limit: 10,
    });
    const ids = candidates.map(candidate => idOf(candidate.id));
    const followups = ids.length ? await request('recruit_followups', 'GET', {
      select: 'id,candidate_id,followup_date,contact_method,interaction_summary,followup_notes',
      candidate_id: `in.(${ids.join(',')})`, deleted_at: 'is.null',
      order: 'followup_date.desc,id.desc', limit: 20,
    }) : [];
    const recent = new Map(ids.map(id => [id, []]));
    for (const row of followups) {
      const list = recent.get(String(row.candidate_id));
      if (list) list.push({
        id: row.id, date: row.followup_date, channel: row.contact_method || null,
        summary: String(row.interaction_summary || row.followup_notes || '增员跟进').slice(0, 500),
      });
    }
    return { rows: candidates.map(candidate => ({
      id: candidate.id, stage: candidate.stage,
      motivation: String(candidate.motivation || '').slice(0, 500),
      concerns: String(candidate.concerns || '').slice(0, 500),
      potentialScore: candidate.potential_score,
      careerPlan: String(candidate.career_plan || '').slice(0, 500),
      nextAction: String(candidate.next_action || '').slice(0, 500),
      nextActionDate: candidate.next_action_date,
      recentFollowups: recent.get(String(candidate.id)) || [],
    })) };
  }

  async function getInsuranceContext(personId) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const context = await new InsuranceContextService({ request }).build(person);
    const refs = [{ table: 'persons', id: String(person.id) }];
    if (context.legacyCustomerId) refs.push({ table: 'customers', id: String(context.legacyCustomerId) });
    const add = source => {
      if (source?.type && source.id != null) refs.push({ table: source.type, id: String(source.id) });
    };
    for (const row of context.existingCoverage) add(row.source);
    add(context.review.latest?.source);
    for (const row of context.review.ocr.concat(context.review.evidence,
      context.knownNeeds, context.potentialGaps, context.openOpportunities,
      context.nextActions)) add(row.source);
    return { ...context, testData: await disclosure(refs) };
  }

  function opportunityData(data, currentType, creating) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid opportunity data');
    const allowed = ['opportunity_type', 'status', 'discovered_at', 'last_progress',
      'next_action', 'next_action_date', 'ai_summary', 'referred_name', 'referred_relation'];
    const payload = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(data, key)) payload[key] = data[key];
    const type = payload.opportunity_type || currentType;
    if (!OPPORTUNITY_TYPES.has(type)) throw new Error('Invalid opportunity type');
    if (payload.opportunity_type != null && typeof payload.opportunity_type !== 'string') {
      throw new Error('Invalid opportunity type');
    }
    const statuses = type === 'referral' ? REFERRAL_STATUSES : OPPORTUNITY_STATUSES;
    if (payload.status != null && !statuses.has(payload.status)) throw new Error('Invalid opportunity status');
    for (const key of ['last_progress', 'next_action', 'ai_summary', 'referred_name', 'referred_relation']) {
      if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > 4000)) {
        throw new Error('Invalid opportunity field');
      }
    }
    for (const key of ['discovered_at', 'next_action_date']) {
      if (payload[key] != null && payload[key] !== '' &&
          (typeof payload[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload[key]))) {
        throw new Error('Invalid opportunity date');
      }
      if (payload[key] === '') payload[key] = null;
    }
    if (creating) payload.status = payload.status || (type === 'referral' ? '潜在线索' : '发现');
    return payload;
  }

  async function findPersonOpportunity(personId, opportunityId) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const row = one(await request('opportunities', 'GET', {
      select: 'id,opportunity_type,status', id: `eq.${idOf(opportunityId)}`,
      person_id: `eq.${idOf(person.id)}`, customer_id: 'is.null',
      deleted_at: 'is.null', limit: 1,
    }));
    if (!row) throw new Error('Person opportunity not found');
    return row;
  }

  async function createOpportunity(personId, data) {
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const payload = opportunityData(data, null, true);
    const saved = one(await request('opportunities', 'POST', {}, {
      ...payload, person_id: Number(person.id), customer_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    if (!saved) throw new Error('Person opportunity could not be saved');
    return { id: saved.id };
  }

  async function updateOpportunity(personId, opportunityId, data) {
    const current = await findPersonOpportunity(personId, opportunityId);
    const payload = opportunityData(data, current.opportunity_type, false);
    if (!Object.keys(payload).length) return { ok: true, updated: false };
    const saved = await request('opportunities', 'PATCH', {
      id: `eq.${idOf(opportunityId)}`, person_id: `eq.${idOf(personId)}`,
      customer_id: 'is.null', deleted_at: 'is.null',
    }, { ...payload, updated_at: new Date().toISOString() });
    return { ok: saved.length === 1 };
  }

  async function closeOpportunity(personId, opportunityId) {
    await findPersonOpportunity(personId, opportunityId);
    const saved = await request('opportunities', 'PATCH', {
      id: `eq.${idOf(opportunityId)}`, person_id: `eq.${idOf(personId)}`,
      customer_id: 'is.null', deleted_at: 'is.null',
    }, { status: '关闭', updated_at: new Date().toISOString() });
    return { ok: saved.length === 1 };
  }

  async function removeOpportunity(personId, opportunityId) {
    await findPersonOpportunity(personId, opportunityId);
    const now = new Date().toISOString();
    const saved = await request('opportunities', 'PATCH', {
      id: `eq.${idOf(opportunityId)}`, person_id: `eq.${idOf(personId)}`,
      customer_id: 'is.null', deleted_at: 'is.null',
    }, { deleted_at: now, updated_at: now });
    return { ok: saved.length === 1 };
  }

  async function search(name) {
    const { nameKey } = parsePersonName(name);
    const candidates = await request('persons', 'GET', {
      select: 'id,display_name,occupation,organization,legacy_customer_id',
      name_key: `eq.${nameKey}`, deleted_at: 'is.null', order: 'id.asc', limit: 11,
    });
    return { candidates: candidates.slice(0, 10), hasMore: candidates.length > 10 };
  }

  const personService = new PersonService({ request });
  async function resolveQuickCaptureName(name) {
    return personService.resolveName(name);
  }

  async function commitQuickCaptureV2(data, uid) {
    if (!uid || data?.confirmed !== true) throw new Error('Human confirmation is required');
    const selectedId = idOf(data.personId);
    const selectedName = data.selectedDisplayName;
    if (typeof selectedName !== 'string') throw new Error('Selected Person is required');
    const resolution = await personService.resolveName(selectedName);
    if (!resolution.candidates.some(candidate =>
      candidate.id === selectedId && candidate.displayName === selectedName)) {
      throw new Error('Selected Person changed; resolve identity again');
    }
    const interaction = data.interaction;
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction) ||
        typeof interaction.type !== 'string' || typeof interaction.at !== 'string' ||
        typeof interaction.summary !== 'string' || typeof interaction.rawNote !== 'string' ||
        interaction.rawNote.length > 10000 || interaction.summary.length > 2000 ||
        (interaction.channel != null && typeof interaction.channel !== 'string')) {
      throw new Error('Invalid Interaction candidate');
    }
    const lists = [data.facts, data.signals];
    if (lists.some((items, index) => !Array.isArray(items) || items.length > (index ? 12 : 20) ||
      items.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 500))) {
      throw new Error('Invalid Context Item candidate');
    }
    return rpc('quick_capture_v2_commit', {
      p_person_id: Number(selectedId), p_selected_display_name: selectedName,
      p_actor_uid: uid, p_interaction: {
        type: interaction.type, at: interaction.at, channel: interaction.channel || '',
        summary: interaction.summary, rawNote: interaction.rawNote,
      }, p_facts: data.facts, p_signals: data.signals,
    });
  }

  async function saveFacts(personId, facts) {
    if (typeof facts !== 'string' || facts.length > 2000) throw new Error('Important facts must be at most 2000 characters');
    const person = await findPerson(personId);
    if (!person) throw new Error('Person not found');
    const household = await findHousehold(person.id);
    const value = facts.trim() || null;
    if (household) {
      await request('households', 'PATCH', { id: `eq.${idOf(household.id)}` },
        { important_facts: value, updated_at: new Date().toISOString() });
    } else if (value) {
      await request('households', 'POST', {}, { anchor_person_id: Number(person.id), important_facts: value });
    }
    return get(person.id);
  }

  async function addMember(personId, memberId, relationship, selectedDisplayName, confirmed, uid) {
    if (confirmed !== true || !uid) throw new Error('Human confirmation is required');
    if (!ROLES.has(relationship)) throw new Error('Invalid family relationship');
    const anchor = await findPerson(personId);
    const member = await findPerson(memberId);
    if (!anchor || !member) throw new Error('Both people must already exist');
    if (String(anchor.id) === String(member.id)) throw new Error('Person cannot be their own family member');
    if (selectedDisplayName !== member.display_name) throw new Error('Selected Person changed; search again');
    let household = await findHousehold(anchor.id);
    if (!household) {
      household = one(await request('households', 'POST', {}, { anchor_person_id: Number(anchor.id) }));
      if (!household) throw new Error('Could not create household');
    }
    await request('household_members', 'POST', {}, {
      household_id: Number(household.id), person_id: Number(member.id),
      relationship_to_anchor: relationship,
      confirmed_at: new Date().toISOString(), confirmed_by_uid: uid,
    });
    return get(anchor.id);
  }

  async function removeMember(personId, membershipId, confirmed) {
    if (confirmed !== true) throw new Error('Human confirmation is required');
    const anchor = await findPerson(personId);
    if (!anchor) throw new Error('Person not found');
    const household = await findHousehold(anchor.id);
    if (!household) throw new Error('Household not found');
    const rows = await request('household_members', 'PATCH', {
      id: `eq.${idOf(membershipId)}`, household_id: `eq.${idOf(household.id)}`,
      deleted_at: 'is.null',
    }, { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (rows.length !== 1) throw new Error('Household member not found');
    return get(anchor.id);
  }

  return { get, lookupCustomer, search, saveFacts, addMember, removeMember,
    listPeople, listOpportunityDirectory, resolveIdentity, previewIdentity, executeIdentity,
    listPersonOnlyRecruits, getPersonOnlyRecruit, listPersonOnlyRecruitTrash,
    changePersonOnlyRecruit,
    listOpportunities, listRecruitContext, createOpportunity, updateOpportunity, closeOpportunity, removeOpportunity,
    getInsuranceContext,
    resolveQuickCaptureName, commitQuickCaptureV2 };
}

exports.main = async event => {
  try {
    const identity = app.auth().getUserInfo();
    const uid = identity && identity.uid;
    if (typeof uid !== 'string' || !uid.trim() ||
        identity.isAnonymous === true || identity.is_anonymous === true) return { error: 'UNAUTHORIZED' };
    const service = createService();
    switch (event?.action) {
      case 'get': return await service.get(event.personId);
      case 'getCustomerProfile': return await getCustomerProfile(event.personId, { request: pgRequest });
      case 'lookupCustomer': return await service.lookupCustomer(event.customerId);
      case 'listPeople': return await service.listPeople(event);
      case 'listPersonOnlyRecruits': return await service.listPersonOnlyRecruits();
      case 'getPersonOnlyRecruit': return await service.getPersonOnlyRecruit(event.id);
      case 'listPersonOnlyRecruitTrash': return await service.listPersonOnlyRecruitTrash();
      case 'removePersonOnlyRecruit': return await service.changePersonOnlyRecruit('remove', [event.id], uid);
      case 'restorePersonOnlyRecruit': return await service.changePersonOnlyRecruit('restore', event.ids, uid);
      case 'resolveIdentity': return await service.resolveIdentity(event.name);
      case 'previewIdentity': return await service.previewIdentity(event.data, uid);
      case 'executeIdentity': return await service.executeIdentity(event.data, uid);
      case 'listOpportunityDirectory': return await service.listOpportunityDirectory(event);
      case 'listPendingOpportunityCandidates': return await new OpportunityWorkflowService({request:pgRequest,rpc:pgRpc}).listPending(uid);
      case 'listOpportunities': return await service.listOpportunities(event.personId);
      case 'getOpportunityLinks': return await new OpportunityWorkflowService({request:pgRequest,rpc:pgRpc})
        .linked(event.personId,event.id,uid);
      case 'listUnlinkedOpportunityActions': return await new OpportunityWorkflowService({request:pgRequest,rpc:pgRpc})
        .availableActions(event.personId,uid);
      case 'previewOpportunity': return await new OpportunityWorkflowService({request:pgRequest,rpc:pgRpc})
        .preview(event.data,uid);
      case 'executeOpportunity': return await new OpportunityWorkflowService({request:pgRequest,rpc:pgRpc})
        .execute(event.previewId,uid);
      case 'listRecruitContext': return await service.listRecruitContext(event.personId);
      case 'getInsuranceContext': return await service.getInsuranceContext(event.personId);
      case 'getRelationshipDecay': return await new RelationshipDecayService({ request: pgRequest })
        .evaluateForPerson(event.personId);
      case 'createOpportunity':
      case 'updateOpportunity':
      case 'closeOpportunity':
      case 'removeOpportunity':
        return {error:'PREVIEW_REQUIRED',message:'请通过服务端预览并人工确认机会变更'};
      case 'search': return await service.search(event.name);
      case 'saveFacts': return await service.saveFacts(event.personId, event.facts);
      case 'addMember': return await service.addMember(
        event.personId, event.memberId, event.relationship,
        event.selectedDisplayName, event.confirmed, uid);
      case 'removeMember': return await service.removeMember(event.personId, event.membershipId, event.confirmed);
      case 'listInteractions': return await new InteractionService({ request: pgRequest })
        .listForPerson(event.personId, { limit: event.limit });
      case 'getTimelinePage': return await new PersonInsightsService({ request: pgRequest })
        .timeline(event.personId, { page: event.page, pageSize: event.pageSize });
      case 'getContextGroups': return await new PersonInsightsService({ request: pgRequest })
        .context(event.personId);
      case 'listActivityData': return await listActivityData(event);
      case 'getMeetingPrepContext': return await new MeetingPrepContextBuilder({ request: pgRequest })
        .build(event.personId);
      case 'listDueCommitments': return await new CommitmentService({ request: pgRequest }).listDue();
      case 'listPersonWorkItems': return await new WorkItemService({request:pgRequest,rpc:pgRpc})
        .listForPerson(event.personId);
      case 'listTodayWorkItems': return await new WorkItemService({request:pgRequest,rpc:pgRpc})
        .listForToday();
      case 'previewWorkItem': return await new WorkItemService({request:pgRequest,rpc:pgRpc})
        .preview(event.data,uid);
      case 'executeWorkItem': return await new WorkItemService({request:pgRequest,rpc:pgRpc})
        .execute(event.previewId,uid);
      case 'createInteraction': return await new InteractionService({ request: pgRequest })
        .createManual(event.personId, event.data, uid);
      case 'recordActivityInteraction': return await new ActivityInteractionService({ request: pgRequest })
        .record(event.data, uid);
      case 'previewActivityReview': return await new ActivityReviewWorkflowService({request:pgRequest,rpc:pgRpc})
        .preview(event.data,uid);
      case 'executeActivityReview': return await new ActivityReviewWorkflowService({request:pgRequest,rpc:pgRpc})
        .execute(event.previewId,uid);
      case 'listActivityOutcomes': return await new ActivityReviewWorkflowService({request:pgRequest,rpc:pgRpc})
        .outcomes(event.activityId);
      case 'resolveQuickCaptureName': return await service.resolveQuickCaptureName(event.name);
      case 'addCanonicalParticipant': return await new ParticipantService({ request: pgRequest })
        .add(event.data, uid);
      case 'createSpeakerProfile': return await new SpeakerProfileService({ request: pgRequest })
        .create(event.data, uid);
      case 'linkSpeakerPerson': return await new SpeakerProfileService({ request: pgRequest })
        .link(event.data, uid);
      case 'commitQuickCaptureV2': return await service.commitQuickCaptureV2(event.data, uid);
      default: return { error: 'Unknown action' };
    }
  } catch (error) {
    return { error: error.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' :
      /^(Invalid |Person |Person-only recruit|Activity |Attendance |Post-event |Participant |Speaker |This customer|Both people|Human confirmation|Selected Person|Household |Important facts|Could not|Same-name|Deleted identity|Customer |Preview |Identity candidates|Idempotency key|Test account|Test parent|Work item|Action |Commitment |Opportunity )/.test(error.message)
        ? error.message : 'Person 360 request failed' };
  }
};

exports.createService = createService;
