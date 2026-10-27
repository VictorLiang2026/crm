/** Person-based, read-only context for the meeting_prep Skill. No model call or CRM write. */
'use strict';

const { InteractionService } = require('./interaction-service');
const { InsuranceContextService } = require('./insurance-context-service');
const { classifyContextItems } = require('./context-facts');
const { HouseholdContextService } = require('./household-context');

const OPEN_OPPORTUNITY_STATUSES = new Set(['成交', '关闭']);
const SOURCE = table => ({ schema: 'public', table });
const clip = (value, max = 400) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const normalized = value => clip(value, 1000).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
function playbookScore(row, objection, scenario) {
  const asked = normalized(objection); const known = normalized(row.objection);
  const requestedScenario = normalized(scenario); const category = normalized(row.scenario);
  let score = 0;
  if (known && asked === known) score += 6;
  else if (known && asked.length >= 3 && known.length >= 3 && (asked.includes(known) || known.includes(asked))) score += 3;
  else if (known) return 0;
  if (requestedScenario && category && requestedScenario === category) score += 2;
  return score;
}

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

  async build(personId, { objection = '', scenario = '' } = {}) {
    const id = idOf(personId);
    const read = (table, filters) => this.request(table, 'GET', filters);
    const person = (await read('persons', { select: 'id,display_name,occupation,organization',
      id: `eq.${id}`, deleted_at: 'is.null', limit: 1 }))[0];
    if (!person) throw new Error('Person not found');
    // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
    const customerRow = (await read('customers', { select: 'Id', person_id: `eq.${id}`,
      deleted_at: 'is.null', limit: 1 }))[0] || null;
    const customerId = customerRow?.Id ?? null;
    const [outgoing, incoming, contextItems,
      storedOpportunities, legacyOpportunities, actions, commitments, interactions, insurance,
      householdContext] = await Promise.all([
      // PMC-15: only human-confirmed edges enter review context; pending candidates stay out.
      read('relationships', { select: 'id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,importance,last_meaningful_interaction_at,status,source',
        from_person_id: `eq.${id}`, deleted_at: 'is.null', status: 'eq.confirmed', order: 'updated_at.desc,id.desc', limit: 5 }),
      read('relationships', { select: 'id,from_person_id,relationship_type,relationship_stage,strength,trust_level,trend,importance,last_meaningful_interaction_at,status,source',
        to_person_id: `eq.${id}`, deleted_at: 'is.null', status: 'eq.confirmed', order: 'updated_at.desc,id.desc', limit: 5 }),
      read('context_items', { select: 'id,item_type,category,content,confidence,confirmed,valid_from,valid_to,last_verified_at,source_type,source_id',
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
      new HouseholdContextService({ request: this.request }).build(id),
    ]);
    const householdGroups = (householdContext.households || []).slice().sort((a, b) =>
      Number(String(b.anchor_person_id) === id) - Number(String(a.anchor_person_id) === id));
    const primaryHousehold = householdGroups[0] || null;
    const primaryFacts = (householdContext.facts || []).find(row =>
      String(row.source?.id) === String(primaryHousehold?.id)) || null;

    const relationshipRows = outgoing.map(row => ({ ...row, direction: 'outgoing', other_person_id: row.to_person_id }))
      .concat(incoming.map(row => ({ ...row, direction: 'incoming', other_person_id: row.from_person_id })));
    const otherIds = [...new Set(relationshipRows.map(row => idOf(row.other_person_id)))];
    const others = otherIds.length ? await read('persons', { select: 'id,display_name',
      id: `in.(${otherIds.join(',')})`, deleted_at: 'is.null', limit: 10 }) : [];
    const otherNames = new Map(others.map(row => [String(row.id), clip(row.display_name, 120)]));
    const classifiedItems = classifyContextItems(contextItems, this.now(), { truncated: contextItems.length >= 30 });
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
    const [knowledgeRows, playbookRows] = await Promise.all([
      read('knowledge_items', { select: 'id,source_id,item_type,source,verified,confidence,content,metadata,lifecycle_status,deleted_at',
        lifecycle_status: 'eq.verified', verified: 'eq.true', deleted_at:'is.null', order: 'updated_at.desc,id.desc', limit: 30 }),
      read('playbooks', { select: 'id,scenario,objection,possible_underlying_reasons,clarifying_questions,response_logic,do_not_say,next_objective,source,confidence,metadata,lifecycle_status,deleted_at',
        lifecycle_status: 'eq.verified', deleted_at:'is.null', order: 'updated_at.desc,id.desc', limit: 30 }),
    ]);
    const sourceIds = [...new Set(knowledgeRows.map(row => row.source_id).filter(value => value != null).map(String))];
    const sourceRows = sourceIds.length ? await read('knowledge_sources', {
      select: 'id,lifecycle_status,deleted_at', id: `in.(${sourceIds.join(',')})`, deleted_at: 'is.null', limit: 100,
    }) : [];
    const availableSources = new Set(sourceRows.filter(row => row.lifecycle_status === 'verified').map(row => String(row.id)));
    const evidenceById = new Map(knowledgeRows.filter(row => row.item_type === 'evidence' && row.verified === true &&
      (row.source_id == null || availableSources.has(String(row.source_id))) &&
      row.confidence != null && Number(row.confidence) >= 0.7 && clip(row.source, 500) && clip(row.content, 5000))
      .map(row => [String(row.id), row]));
    const curatedEvidence = [...evidenceById.values()].slice(0, 12).map(row => ({
      content: clip(row.content, 1000), source: clip(row.source, 300), confidence: Number(row.confidence),
      published_at: row.metadata?.published_at || null, reference: { ...SOURCE('knowledge_items'), id: row.id, item_type: 'evidence' },
    }));
    const curatedPlaybooks = playbookRows.map(row => ({ row, score: playbookScore(row, objection, scenario) }))
      .filter(({ row, score }) => score > 0 && Number(row.confidence) >= 0.7)
      .sort((a,b) => b.score - a.score).slice(0, 3).map(({row}) => ({ scenario: clip(row.scenario, 160), objection: clip(row.objection, 500),
        response_logic: clip(row.response_logic, 2000), possible_underlying_reasons: row.possible_underlying_reasons,
        clarifying_questions: row.clarifying_questions, do_not_say: row.do_not_say,
        next_objective: clip(row.next_objective, 300), published_at: row.metadata?.published_at || null }));

    return {
      person: { data: { id: person.id, display_name: clip(person.display_name, 120),
        occupation: clip(person.occupation, 120), organization: clip(person.organization, 120) },
      source: { ...SOURCE('persons'), id: person.id } },
      household: primaryHousehold ? { important_facts: primaryFacts?.content || '',
        members: householdContext.members, households: householdGroups.map(group => ({ ...group,
          important_facts: (householdContext.facts || []).find(row =>
            String(row.source?.id) === String(group.id))?.content || '' })),
        source: primaryHousehold.source } : null,
      relationship: relationshipRows.map(row => ({ direction: row.direction,
        other_person_id: row.other_person_id, other_name: otherNames.get(String(row.other_person_id)) || null,
        type: row.relationship_type, stage: row.relationship_stage, strength: row.strength,
        trust_level: row.trust_level, trend: row.trend, importance: row.importance ?? null,
        last_meaningful_interaction_at: row.last_meaningful_interaction_at,
        source: { ...SOURCE('relationships'), id: row.id } })),
      recent_interactions: recent.slice(0, 6).map(row => ({
        at: row.interaction_at, type: clip(row.interaction_type, 80), channel: clip(row.channel, 80),
        summary: clip(row.summary, 500), importance: row.importance,
        source: { ...SOURCE(row.virtual ? row.source_type : 'interactions'), id: row.source_id || row.id },
      })),
      facts: classifiedItems.trustedFacts.slice(0, 10).map(contextItem),
      signals: [
        ...classifiedItems.signals.map(row => ({ ...contextItem(row), certainty: 'unverified_signal' })),
        ...classifiedItems.inferences.map(row => ({ ...contextItem(row), certainty: 'uncertain_inference' })),
      ].slice(0, 10),
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
      relevant_playbook: curatedPlaybooks.length || curatedEvidence.length ? {
        status: 'available', content: { relevant_playbooks: curatedPlaybooks, reliable_evidence: curatedEvidence },
      } : { status: 'unavailable', content: null,
        reason: 'No reviewed matching playbook or qualifying evidence is available.' },
    };
  }
}

module.exports = { MeetingPrepContextBuilder };
