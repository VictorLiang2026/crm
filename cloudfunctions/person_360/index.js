/** Person 360 family context. The API key is server-only and never returned. */
'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { parsePersonName } = require('./person-service');

const app = cloudbase.init({ env: process.env.TCB_ENV });
const TABLES = new Set(['persons', 'households', 'household_members']);
const ROLES = new Set(['spouse', 'child', 'parent', 'sibling', 'other']);

function idOf(value) {
  const s = String(value ?? '');
  if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error('Invalid Person ID');
  return s;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

async function pgRequest(table, method, filters = {}, body) {
  if (!TABLES.has(table)) throw new Error('Invalid table');
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

function createService({ request = pgRequest } = {}) {
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

  async function search(name) {
    const { nameKey } = parsePersonName(name);
    const candidates = await request('persons', 'GET', {
      select: 'id,display_name,occupation,organization,legacy_customer_id',
      name_key: `eq.${nameKey}`, deleted_at: 'is.null', order: 'id.asc', limit: 11,
    });
    return { candidates: candidates.slice(0, 10), hasMore: candidates.length > 10 };
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

  return { get, lookupCustomer, search, saveFacts, addMember, removeMember };
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
      case 'search': return await service.search(event.name);
      case 'saveFacts': return await service.saveFacts(event.personId, event.facts);
      case 'addMember': return await service.addMember(
        event.personId, event.memberId, event.relationship,
        event.selectedDisplayName, event.confirmed, uid);
      case 'removeMember': return await service.removeMember(event.personId, event.membershipId, event.confirmed);
      default: return { error: 'Unknown action' };
    }
  } catch (error) {
    return { error: error.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' :
      /^(Invalid |Person |This customer|Both people|Human confirmation|Selected Person|Household |Important facts|Could not)/.test(error.message)
        ? error.message : 'Person 360 request failed' };
  }
};

exports.createService = createService;
