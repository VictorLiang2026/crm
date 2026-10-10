/** Read-only Person-level relationship signal candidate built from public CRM sources. */
'use strict';

const { InteractionService } = require('./interaction-service');
const testData = require('./test-data');
const { evaluateRelationshipDecay } = require('./relationship-decay-core');

const PRIORITY_IMPORTANCE = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const CADENCE_TYPES = new Set(['followup', 'recruit_followup', 'manual']);
const idOf = value => {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
};

function current(row, nowMs) {
  return row.confirmed === true && (!row.valid_to || Date.parse(row.valid_to) > nowMs);
}

function factValue(row) {
  const structured = row.structured_value;
  if (typeof structured === 'string' || typeof structured === 'number') return structured;
  if (structured && typeof structured === 'object' && !Array.isArray(structured) &&
      (typeof structured.value === 'string' || typeof structured.value === 'number')) return structured.value;
  return row.content;
}

class RelationshipDecayService {
  constructor({ request, listInteractions, now = () => new Date() } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
    this.listInteractions = listInteractions || (id => new InteractionService({ request }).listForPerson(id, { limit: 30 }));
    this.now = now;
  }

  async evaluateForPerson(personId) {
    const id = idOf(personId);
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid evaluation time');
    const read = (table, filters) => this.request(table, 'GET', filters);
    const person = (await read('persons', { select: 'id',
      id: `eq.${id}`, deleted_at: 'is.null', limit: 1 }))[0];
    if (!person) throw new Error('Person not found');
    const [facts, customers, timeline] = await Promise.all([
      read('context_items', { select: 'id,item_type,category,content,structured_value,confirmed,valid_to,created_at',
        person_id: `eq.${id}`, item_type: 'in.(fact,inference)', confirmed: 'eq.true',
        category: 'in.(relationship_strength,relationship_importance,last_meaningful_interaction_at)',
        order: 'created_at.desc,id.desc', limit: 30 }),
      // PMC-19 CL-03: legacy_customer_id removed; resolve customer via customers.person_id
      read('customers', {
        select: 'Id,sales_priority', person_id: `eq.${id}`,
        deleted_at: 'is.null', limit: 1 }),
      this.listInteractions(id),
    ]);
    const assessed = facts.filter(row => current(row, now.getTime()));
    const latest = (category, type) => assessed.find(row => row.category === category && row.item_type === type);
    // Strength and importance are human assessments, not asserted facts.
    const strengthFact = latest('relationship_strength', 'inference');
    const importanceFact = latest('relationship_importance', 'inference');
    const meaningfulFact = latest('last_meaningful_interaction_at', 'fact');
    const priority = customers[0]?.sales_priority;
    const explicitImportance = importanceFact ? factValue(importanceFact) : null;
    const importance = explicitImportance ?? PRIORITY_IMPORTANCE[String(priority || '')] ?? null;
    const importanceSource = importanceFact ? 'explicit' :
      importance != null ? 'sales_priority_proxy' : 'unknown';
    const rows = Array.isArray(timeline?.rows) ? timeline.rows : [];
    const meaningfulRows = rows.filter(row => row.virtual !== true &&
      Number(row.importance) >= 4 && row.interaction_at);
    const latestMeaningful = meaningfulRows.sort((a, b) =>
      Date.parse(b.interaction_at) - Date.parse(a.interaction_at))[0];
    const factTime = meaningfulFact ? factValue(meaningfulFact) : null;
    const candidates = [
      factTime ? { at: factTime, source: `public.context_items#${meaningfulFact.id}` } : null,
      latestMeaningful ? { at: latestMeaningful.interaction_at,
        source: `public.interactions#${latestMeaningful.id}` } : null,
    ].filter(item => item && Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) <= now.getTime());
    candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const meaningful = candidates[0];
    const cadenceRows = rows.filter(row => CADENCE_TYPES.has(row.interaction_type) &&
      Number(row.importance) >= 3 && row.interaction_at);
    const result = evaluateRelationshipDecay({ now,
      strength: strengthFact ? factValue(strengthFact) : null,
      importance, importanceSource,
      lastMeaningfulAt: meaningful?.at,
      meaningfulSource: meaningful ? 'explicit' : 'unknown',
      interactionTimes: cadenceRows.map(row => row.interaction_at) });
    const disclosure = await testData.disclose([...testData.refsForRows('persons',[person]), ...testData.refsForRows('customers',customers), ...testData.refsForRows('context_items',assessed), ...rows.flatMap(r => testData.refsForRows(r.virtual ? r.source_type : 'interactions',[{id:r.source_id || r.id}]))]);
    return { ...result, testData: disclosure, person_id: person.id, candidate: result.status === 'signal',
      persisted: false, sources: {
        strength: strengthFact ? `public.context_items#${strengthFact.id}` : null,
        importance: importanceFact ? `public.context_items#${importanceFact.id}` :
          importanceSource === 'sales_priority_proxy' ? `public.customers#${customers[0].Id}` : null,
        last_meaningful: meaningful?.source || null,
        cadence: cadenceRows.slice(0, 24).map(row =>
          `public.${row.virtual ? row.source_type : 'interactions'}#${row.source_id || row.id}`),
      } };
  }
}

module.exports = { RelationshipDecayService };
