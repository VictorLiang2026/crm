'use strict';

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
}

const clip = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const SOURCE = table => ({ schema: 'public', table });

/** Only server-confirmed, active household data crosses this boundary into AI context. */
class HouseholdContextService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
  }

  async build(personId) {
    const id = idOf(personId);
    const read = (table, filters) => this.request(table, 'GET', filters);
    const [owned, links] = await Promise.all([
      read('households', { select: 'id,anchor_person_id,important_facts,important_facts_confirmed_at,important_facts_confirmed_by_uid',
        anchor_person_id: `eq.${id}`, deleted_at: 'is.null', order: 'id.asc', limit: 5 }),
      read('household_members', { select: 'id,household_id,person_id,relationship_to_anchor,confirmed_at',
        person_id: `eq.${id}`, confirmed_at: 'not.is.null', deleted_at: 'is.null', order: 'id.asc', limit: 20 }),
    ]);
    const householdIds = [...new Set([...(owned || []).map(row => String(row.id)),
      ...(links || []).map(row => String(row.household_id))])].slice(0, 5);
    if (!householdIds.length) return { households: [], members: [], facts: [] };
    const groups = householdIds.length ? await read('households', {
      select: 'id,anchor_person_id,important_facts,important_facts_confirmed_at,important_facts_confirmed_by_uid',
      id: `in.(${householdIds.join(',')})`, deleted_at: 'is.null', order: 'id.asc', limit: 5,
    }) : [];
    const households = [];
    const members = [];
    const facts = [];
    for (const household of groups || []) {
      const confirmedFacts = household.important_facts_confirmed_at && household.important_facts_confirmed_by_uid
        ? clip(household.important_facts, 500) : '';
      const rows = await read('household_members', {
        select: 'id,person_id,relationship_to_anchor,confirmed_at', household_id: `eq.${idOf(household.id)}`,
        confirmed_at: 'not.is.null', deleted_at: 'is.null', order: 'id.asc', limit: 20,
      });
      const activeMembers = (rows || []).filter(row => row.confirmed_at);
      const personIds = [...new Set([household.anchor_person_id, ...activeMembers.map(row => row.person_id)].map(idOf))];
      const people = personIds.length ? await read('persons', {
        select: 'id,display_name', id: `in.(${personIds.join(',')})`, deleted_at: 'is.null', limit: 31,
      }) : [];
      const names = new Map((people || []).map(row => [String(row.id), clip(row.display_name, 120)]));
      const groupMembers = activeMembers.map(row => ({
        household_id: household.id, anchor_person_id: household.anchor_person_id,
        person_id: row.person_id, display_name: names.get(String(row.person_id)) || null,
        relationship_to_anchor: row.relationship_to_anchor,
        source: { ...SOURCE('household_members'), id: row.id },
      }));
      if (String(household.anchor_person_id) !== id) groupMembers.unshift({
        household_id: household.id, anchor_person_id: household.anchor_person_id,
        person_id: household.anchor_person_id, display_name: names.get(String(household.anchor_person_id)) || null,
        relationship_to_anchor: 'anchor', source: { ...SOURCE('households'), id: household.id },
      });
      const group = { id: household.id, anchor_person_id: household.anchor_person_id,
        isAnchor: String(household.anchor_person_id) === id,
        members: groupMembers, source: { ...SOURCE('households'), id: household.id } };
      households.push(group);
      members.push(...groupMembers);
      if (confirmedFacts) facts.push({ content: confirmedFacts,
        source: { ...SOURCE('households'), id: household.id }, confirmed_at: household.important_facts_confirmed_at });
    }
    return { households, members: members.slice(0, 30), facts: facts.slice(0, 5) };
  }
}

module.exports = { HouseholdContextService };
