/** Person-based, read-only context for the meeting_prep Skill. No model call or CRM write. */
'use strict';

const { InteractionService } = require('./interaction-service');
const { InsuranceContextService } = require('./insurance-context-service');

const OPEN_OPPORTUNITY_STATUSES = new Set(['成交', '关闭']);
const SOURCE = table => ({ schema: 'public', table });
const clip = (value, max = 400) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
}

class MeetingPrepContextBuilder {
  constructor({ request, listInteractions, insuranceContext, now = () => new Date() } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
    this.listInteractions = listInteractions || (id => new InteractionService({ request }).listForPerson(id, { limit: 6 }));
    this.insuranceContext = insuranceContext || (person => new InsuranceContextService({ request }).build(person));
    this.now = now;
  }

  async build(personId) {
    const id = idOf(personId);
    const read = (table, filters) => this.request(table, 'GET', filters);
    const person = (await read('persons', { select: 'id,display_name,occupation,organization',
      id: `eq.${id}`, deleted_at: 'is.null', limit: 1 }))[0];
    if (!person) throw new Error('Person not found');
    // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
    const customerRow = (await read('customers', { select: 'Id', person_id: `eq.${id}`,
      deleted_at: 'is.null', limit: 1 }))[0] || null;
    const customerId = customerRow?.Id ?? null;
    const [ownedHouseholds, memberships, outgoing, incoming, contextItems,
      storedOpportunities, legacyOpportunities, actions, commitments, interactions, insurance] = await Promise.all([
      read('households', { select: 'id,anchor_person_id,important_facts',
        anchor_person_id: `eq.${id}`, deleted_at: 'is.null', limit: 1 }),
      read('household_members', { select: 'id,household_id', person_id: `eq.${id}`,
        deleted_at: 'is.null', order: 'id.desc', limit: 1 }),
      // PMC-15: only human-confirmed edges enter review context; pending candidates stay out.
      read('relationships', { select: 'id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,last_meaningful_interaction_at,status,source',
        from_person_id: `eq.${id}`, deleted_at: 'is.null', status: 'eq.confirmed', order: 'updated_at.desc,id.desc', limit: 5 }),
      read('relationships', { select: 'id,from_person_id,relationship_type,relationship_stage,strength,trust_level,trend,last_meaningful_interaction_at,status,source',
        to_person_id: `eq.${id}`, deleted_at: 'is.null', status: 'eq.confirmed', order: 'updated_at.desc,id.desc', limit: 5 }),
      read('context_items', { select: 'id,item_type,category,content,confidence,confirmed,valid_to,last_verified_at,source_type,source_id',
        person_id: `eq.${id}`, order: 'created_at.desc,id.desc', limit: 30 }),
      read('opportunities', { select: 'id,opportunity_type,status,last_progress,next_action,next_action_date,updated_at',
        person_id: `eq.${id}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 30 }),
      customerId ? read('opportunities', { select: 'id,opportunity_type,status,last_progress,next_action,next_action_date,updated_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 30 }) : [],
      read('actions', { select: 'id,opportunity_id,title,due_at,priority,status',
        person_id: `eq.${id}`, status: 'in.(open,in_progress)', order: 'due_at.asc.nullslast,id.desc', limit: 10 }),
      read('commitments', { select: 'id,commitment_type,content,due_at,status',
        person_id: `eq.${id}`, status: 'eq.open', order: 'due_at.asc.nullslast,id.desc', limit: 10 }),
      this.listInteractions(id),
      this.insuranceContext(person),
    ]);

    let household = ownedHouseholds[0] || null;
    if (!household && memberships[0]) {
      household = (await read('households', { select: 'id,anchor_person_id,important_facts',
        id: `eq.${idOf(memberships[0].household_id)}`, deleted_at: 'is.null', limit: 1 }))[0] || null;
    }
    let householdMembers = [];
    if (household) {
      const members = await read('household_members', {
        select: 'id,person_id,relationship_to_anchor,confirmed_at', household_id: `eq.${idOf(household.id)}`,
        deleted_at: 'is.null', order: 'id.asc', limit: 20,
      });
      const memberIds = [...new Set([household.anchor_person_id, ...members.map(row => row.person_id)].map(idOf))];
      const people = memberIds.length ? await read('persons', { select: 'id,display_name',
        id: `in.(${memberIds.join(',')})`, deleted_at: 'is.null', limit: 21 }) : [];
      const names = new Map(people.map(row => [String(row.id), clip(row.display_name, 120)]));
      householdMembers = members.filter(row => row.confirmed_at).map(row => ({
        person_id: row.person_id, display_name: names.get(String(row.person_id)) || null,
        relationship_to_anchor: row.relationship_to_anchor,
        source: { ...SOURCE('household_members'), id: row.id },
      }));
      if (String(household.anchor_person_id) !== id) householdMembers.unshift({
        person_id: household.anchor_person_id,
        display_name: names.get(String(household.anchor_person_id)) || null,
        relationship_to_anchor: 'anchor',
        source: { ...SOURCE('households'), id: household.id },
      });
    }

    const relationshipRows = outgoing.map(row => ({ ...row, direction: 'outgoing', other_person_id: row.to_person_id }))
      .concat(incoming.map(row => ({ ...row, direction: 'incoming', other_person_id: row.from_person_id })));
    const otherIds = [...new Set(relationshipRows.map(row => idOf(row.other_person_id)))];
    const others = otherIds.length ? await read('persons', { select: 'id,display_name',
      id: `in.(${otherIds.join(',')})`, deleted_at: 'is.null', limit: 10 }) : [];
    const otherNames = new Map(others.map(row => [String(row.id), clip(row.display_name, 120)]));
    const validAt = this.now().getTime();
    const currentItems = contextItems.filter(row => !row.valid_to || Date.parse(row.valid_to) > validAt);
    const contextItem = row => ({ content: clip(row.content, 500), category: clip(row.category, 80),
      confidence: row.confidence, confirmed: row.confirmed, last_verified_at: row.last_verified_at,
      source: { ...SOURCE('context_items'), id: row.id, original_type: row.source_type,
        original_id: row.source_id } });
    const opportunityById = new Map();
    for (const row of storedOpportunities.concat(legacyOpportunities)) {
      if (!OPEN_OPPORTUNITY_STATUSES.has(row.status)) opportunityById.set(String(row.id), row);
    }
    const openOpportunities = [...opportunityById.values()]
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 10);
    const recent = Array.isArray(interactions?.rows) ? interactions.rows : [];

    return {
      person: { data: { id: person.id, display_name: clip(person.display_name, 120),
        occupation: clip(person.occupation, 120), organization: clip(person.organization, 120) },
      source: { ...SOURCE('persons'), id: person.id } },
      household: household ? { important_facts: clip(household.important_facts, 500),
        members: householdMembers, source: { ...SOURCE('households'), id: household.id } } : null,
      relationship: relationshipRows.map(row => ({ direction: row.direction,
        other_person_id: row.other_person_id, other_name: otherNames.get(String(row.other_person_id)) || null,
        type: row.relationship_type, stage: row.relationship_stage, strength: row.strength,
        trust_level: row.trust_level, trend: row.trend,
        last_meaningful_interaction_at: row.last_meaningful_interaction_at,
        source: { ...SOURCE('relationships'), id: row.id } })),
      recent_interactions: recent.slice(0, 6).map(row => ({
        at: row.interaction_at, type: clip(row.interaction_type, 80), channel: clip(row.channel, 80),
        summary: clip(row.summary, 500), importance: row.importance,
        source: { ...SOURCE(row.virtual ? row.source_type : 'interactions'), id: row.source_id || row.id },
      })),
      facts: currentItems.filter(row => row.item_type === 'fact' && row.confirmed === true)
        .slice(0, 10).map(contextItem),
      signals: currentItems.filter(row => row.item_type === 'signal').slice(0, 10).map(contextItem),
      open_opportunities: openOpportunities.map(row => ({ type: row.opportunity_type,
        status: row.status, last_progress: clip(row.last_progress, 300),
        next_action: clip(row.next_action, 300), next_action_date: row.next_action_date,
        source: { ...SOURCE('opportunities'), id: row.id } })),
      open_actions: actions.map(row => ({ title: clip(row.title, 200), due_at: row.due_at,
        priority: row.priority, opportunity_id: row.opportunity_id,
        source: { ...SOURCE('actions'), id: row.id } })),
      commitments: commitments.map(row => ({ type: row.commitment_type,
        content: clip(row.content, 300), due_at: row.due_at,
        source: { ...SOURCE('commitments'), id: row.id } })),
      insurance_context: { ...insurance, source: { schema: 'public', service: 'InsuranceContextService' } },
      relevant_playbook: { status: 'unavailable', content: null,
        reason: 'No maintained playbook content source exists in this CRM.' },
    };
  }
}

module.exports = { MeetingPrepContextBuilder };
