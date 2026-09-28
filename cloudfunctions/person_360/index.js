/** Person 360 family context. The API key is server-only and never returned. */
'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { parsePersonName, PersonService } = require('./person-service');
const { InteractionService } = require('./interaction-service');
const { CommitmentService } = require('./commitment-service');

const app = cloudbase.init({ env: process.env.TCB_ENV });
const LEGACY_INTERACTION_TABLES = new Set([
  'followups', 'recruit_candidates', 'recruit_followups',
  'activity_participants', 'activity_speakers', 'activities',
]);
const TABLES = new Set([
  'persons', 'households', 'household_members', 'interactions', 'commitments',
  'opportunities',
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

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

async function pgRequest(table, method, filters = {}, body) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
  if (LEGACY_INTERACTION_TABLES.has(table) && method !== 'GET') throw new Error('Invalid source operation');
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
  if (name !== 'quick_capture_v2_commit') throw new Error('Invalid RPC');
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
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Unexpected database response');
    return result;
  } finally { clearTimeout(timeout); }
}

function createService({ request = pgRequest, rpc = pgRpc } = {}) {
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
    return { rows: [...byId.values()].sort((a, b) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || ''))) };
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
    listOpportunities, createOpportunity, updateOpportunity, closeOpportunity, removeOpportunity,
    resolveQuickCaptureName, commitQuickCaptureV2 };
}

exports.main = async event => {
  try {
    const identity = app.auth().getUserInfo();
    const uid = identity && identity.uid;
    if (typeof uid !== 'string' || !uid.trim()) return { error: 'UNAUTHORIZED' };
    const service = createService();
    switch (event?.action) {
      case 'get': return await service.get(event.personId);
      case 'lookupCustomer': return await service.lookupCustomer(event.customerId);
      case 'listOpportunities': return await service.listOpportunities(event.personId);
      case 'createOpportunity': return await service.createOpportunity(event.personId, event.data);
      case 'updateOpportunity': return await service.updateOpportunity(event.personId, event.id, event.data);
      case 'closeOpportunity': return await service.closeOpportunity(event.personId, event.id);
      case 'removeOpportunity': return await service.removeOpportunity(event.personId, event.id);
      case 'search': return await service.search(event.name);
      case 'saveFacts': return await service.saveFacts(event.personId, event.facts);
      case 'addMember': return await service.addMember(
        event.personId, event.memberId, event.relationship,
        event.selectedDisplayName, event.confirmed, uid);
      case 'removeMember': return await service.removeMember(event.personId, event.membershipId, event.confirmed);
      case 'listInteractions': return await new InteractionService({ request: pgRequest })
        .listForPerson(event.personId, { limit: event.limit });
      case 'listDueCommitments': return await new CommitmentService({ request: pgRequest }).listDue();
      case 'createInteraction': return await new InteractionService({ request: pgRequest })
        .createManual(event.personId, event.data, uid);
      case 'resolveQuickCaptureName': return await service.resolveQuickCaptureName(event.name);
      case 'commitQuickCaptureV2': return await service.commitQuickCaptureV2(event.data, uid);
      default: return { error: 'Unknown action' };
    }
  } catch (error) {
    return { error: error.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' :
      /^(Invalid |Person |Activity not found|This customer|Both people|Human confirmation|Selected Person|Household |Important facts|Could not)/.test(error.message)
        ? error.message : 'Person 360 request failed' };
  }
};

exports.createService = createService;
