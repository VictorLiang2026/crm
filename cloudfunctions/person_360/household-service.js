'use strict';

const { PersonService } = require('./person-service');

const RELATIONSHIPS = new Set(['spouse', 'child', 'parent', 'sibling', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

class HouseholdService {
  constructor({ request, rpc }) {
    if (typeof request !== 'function' || typeof rpc !== 'function') {
      throw new Error('Authorized household database adapters are required');
    }
    this.request = request;
    this.rpc = rpc;
  }

  async listForPerson(personId) {
    const pid = idOf(personId);
    const person = one(await this.request('persons', 'GET', {
      select: 'id,display_name', id: `eq.${pid}`, deleted_at: 'is.null', limit: 1,
    }));
    if (!person) throw new Error('Person not found');
    const [owned, links] = await Promise.all([
      this.request('households', 'GET', {
        select: 'id,anchor_person_id,important_facts,important_facts_confirmed_at,important_facts_confirmed_by_uid,updated_at',
        anchor_person_id: `eq.${pid}`, deleted_at: 'is.null', order: 'id.asc', limit: 1,
      }),
      this.request('household_members', 'GET', {
        select: 'id,household_id,person_id,relationship_to_anchor,confirmed_at,confirmed_by_uid,updated_at',
        person_id: `eq.${pid}`, deleted_at: 'is.null', order: 'id.asc', limit: 50,
      }),
    ]);
    const householdIds = [...new Set([
      ...(owned || []).map(row => idOf(row.id)),
      ...(links || []).filter(row => row.confirmed_at).map(row => idOf(row.household_id)),
    ])];
    if (!householdIds.length) return { household: null, members: [], households: [] };
    const groups = await this.request('households', 'GET', {
      select: 'id,anchor_person_id,important_facts,important_facts_confirmed_at,important_facts_confirmed_by_uid,updated_at',
      id: `in.(${householdIds.join(',')})`, deleted_at: 'is.null', order: 'id.asc', limit: 50,
    });
    const groupList = [];
    for (const household of groups || []) {
      const members = await this.request('household_members', 'GET', {
        select: 'id,household_id,person_id,relationship_to_anchor,confirmed_at,confirmed_by_uid,updated_at',
        household_id: `eq.${idOf(household.id)}`, deleted_at: 'is.null', order: 'id.asc', limit: 50,
      });
      const active = members || [];
      const peopleIds = [...new Set([household.anchor_person_id, ...active.map(row => row.person_id)].map(idOf))];
      const people = await this.request('persons', 'GET', {
        select: 'id,display_name', id: `in.(${peopleIds.join(',')})`, deleted_at: 'is.null', limit: 51,
      });
      const names = new Map((people || []).map(row => [String(row.id), row]));
      groupList.push({
        household,
        anchor: names.get(String(household.anchor_person_id)) || null,
        members: active.map(row => ({ ...row, person: names.get(String(row.person_id)) || null })),
        isAnchor: String(household.anchor_person_id) === pid,
        currentMembership: active.find(row => String(row.person_id) === pid) || null,
      });
    }
    groupList.sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor) || Number(a.household.id) - Number(b.household.id));
    const primary = groupList[0] || null;
    return {
      household: primary?.household || null,
      members: primary?.members || [],
      households: groupList,
    };
  }

  async resolveMemberName(name) {
    return new PersonService({ request: this.request }).resolveName(name);
  }

  async preview(personId, operation, payload, actorUid) {
    const pid = idOf(personId);
    if (!actorUid || !UUID.test(String(payload?.idempotencyKey || '')) ||
        !['add_member', 'update_member', 'remove_member', 'save_facts'].includes(operation) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid household review command');
    }
    const data = { ...payload };
    delete data.idempotencyKey;
    if (operation === 'add_member') {
      const memberId = idOf(data.memberId);
      if (String(memberId) === pid || typeof data.memberName !== 'string' ||
          !RELATIONSHIPS.has(data.relationship)) throw new Error('Invalid household Person selection');
      const identity = await this.resolveMemberName(data.memberName);
      const selected = identity.candidates.find(candidate => candidate.id === memberId);
      if (!selected) throw new Error('Selected Person is not in the current identity results; resolve again');
      data.memberName = identity.displayName;
    } else if (operation === 'update_member' && !RELATIONSHIPS.has(data.relationship)) {
      throw new Error('Invalid household relationship');
    }
    const result = await this.rpc('crm_household_preview_v1', {
      p_actor_uid: actorUid,
      p_idempotency_key: payload.idempotencyKey,
      p_person_id: Number(pid),
      p_operation: operation,
      p_payload: data,
    });
    return one(result) || result;
  }

  async execute(previewId, actorUid) {
    const id = String(previewId || '');
    if (!actorUid || !UUID.test(id)) throw new Error('Invalid household preview');
    const result = await this.rpc('crm_household_execute_v1', {
      p_actor_uid: actorUid, p_preview_id: id,
    });
    return one(result) || result;
  }
}

module.exports = { HouseholdService, RELATIONSHIPS };
