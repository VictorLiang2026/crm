/** Read-through, bounded Person 360 timeline and context. No legacy backfill. */
'use strict';
const { InteractionService, boundedInteractionRead } = require('./interaction-service');
const testData = require('./test-data');
const { classifyContextItems } = require('./context-facts');

const idOf = value => {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw Error('Invalid Person ID');
  return id;
};
const safePage = value => {
  const n = Number(value ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw Error('Invalid timeline page');
  return n;
};
const safeSize = value => {
  const n = Number(value ?? 10);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw Error('Invalid timeline page size');
  return n;
};
const latest = (...values) => values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

class PersonInsightsService {
  constructor({ request, disclose = testData.disclose } = {}) {
    if (typeof request !== 'function') throw Error('Authorized database request is required');
    this.request = request;
    this.disclose = disclose;
  }

  async timeline(personId, options = {}) {
    const page = safePage(options.page), pageSize = safeSize(options.pageSize);
    const id = idOf(personId);
    const { rows: unique, person, customerId } = await new InteractionService({
      request: boundedInteractionRead(this.request),
    }).collectForPerson(id);
    const pageRows = unique.slice((page - 1) * pageSize, page * pageSize).map(row => ({
      id: row.id, interactionId: row.virtual ? null : row.id, type: row.interaction_type, at: row.interaction_at,
      timePrecision: row.time_precision || null, editable: !row.virtual && ['manual','followups'].includes(row.source_type),
      summary: row.summary, channel: row.channel || null,
      source: `public.${row.source_id == null ? 'interactions' : row.source_type}#${row.source_id ?? row.id}`,
      activityId: row.activity_id || null, candidateId: row.candidate_id || null,
      customerId: row.source_type === 'followups' ? customerId : null,
    }));
    const refs = [ ...testData.refsForRows('persons', [person]), ...pageRows.map(row => {
      const match = /^public\.([a-z_]+)#([1-9]\d*)$/.exec(row.source);
      return { table: match[1], id: match[2] };
    }) ];
    return { rows: pageRows, page, pageSize, hasMore: unique.length > page * pageSize,
      testData: await this.disclose(refs) };
  }

  async context(personId) {
    const id = idOf(personId);
    const person = await new InteractionService({ request: this.request }).findPerson(id);
    const groups = { fact: [], signal: [], inference: [] };
    const refs = testData.refsForRows('persons', [person]);
    const allRows = [];
    for (const type of ['fact', 'signal', 'inference']) {
      const rows = await this.request('context_items', 'GET', {
        select: 'id,person_id,interaction_id,item_type,category,content,structured_value,source_type,source_id,confidence,confirmed,confirmed_by_uid,confirmed_at,valid_from,valid_to,last_verified_at,created_at',
        person_id: `eq.${id}`, item_type: `eq.${type}`, order: 'created_at.desc,id.desc', limit: 50,
      });
      refs.push(...testData.refsForRows('context_items', rows));
      allRows.push(...rows);
    }
    const itemIds = allRows.map(row => String(row.id));
    const interactionIds = [...new Set(allRows.map(row => row.interaction_id).filter(value => value != null).map(String))];
    const originIds = [...new Set(allRows.filter(row => row.source_type === 'context_items' && row.source_id != null)
      .map(row => String(row.source_id)))];
    const [sources, audits, origins] = await Promise.all([
      interactionIds.length ? this.request('interactions', 'GET', {
        select: 'id,person_id,interaction_type,interaction_at,channel,summary,raw_note',
        deleted_at: 'is.null', id: `in.(${interactionIds.join(',')})`, person_id: `eq.${id}`, limit: 45,
      }) : [],
      itemIds.length ? this.request('crm_context_item_commands', 'GET', {
        select: 'item_id,operation,status,executed_at,result', item_id: `in.(${itemIds.join(',')})`,
        status: 'eq.executed', order: 'executed_at.desc', limit: 100,
      }) : [],
      originIds.length ? this.request('context_items', 'GET', {
        select: 'id,person_id,interaction_id,item_type,category,content,source_type,source_id',
        id: `in.(${originIds.join(',')})`, person_id: `eq.${id}`, limit: 50,
      }) : [],
    ]);
    const sourceById = new Map(sources.map(row => [String(row.id), row]));
    const auditByItem = new Map();
    for (const event of audits) if (!auditByItem.has(String(event.item_id))) auditByItem.set(String(event.item_id), event);
    const originById = new Map(origins.map(row => [String(row.id), row]));
    const classification = classifyContextItems(allRows, new Date(), {
      truncated: allRows.filter(row => row.item_type === 'fact').length >= 50,
    });
    const now = Date.now();
    for (const row of allRows) {
      const validFrom = row.valid_from ? Date.parse(row.valid_from) : null;
      const validTo = row.valid_to ? Date.parse(row.valid_to) : null;
      const audit = auditByItem.get(String(row.id));
      const sourceInteraction = row.interaction_id == null ? null : sourceById.get(String(row.interaction_id)) || null;
      const originContext = row.source_type === 'context_items' && row.source_id != null
        ? originById.get(String(row.source_id)) || null : null;
      const validity = validTo != null && validTo < now ? 'expired'
        : validFrom != null && validFrom > now ? 'future' : 'current';
      groups[row.item_type].push({ id: row.id, personId: row.person_id, category: row.category,
        content: row.content, source: `public.context_items#${row.id}`,
        origin: row.source_type && row.source_id != null ? `${row.source_type}#${row.source_id}` : row.source_type,
        sourceType: row.source_type, sourceId: row.source_id, interactionId: row.interaction_id,
        sourceInteraction: sourceInteraction ? { id: sourceInteraction.id, type: sourceInteraction.interaction_type,
          at: sourceInteraction.interaction_at, channel: sourceInteraction.channel,
          summary: sourceInteraction.summary, rawNote: sourceInteraction.raw_note } : null,
        derivedFrom: originContext ? { id: originContext.id, type: originContext.item_type,
          category: originContext.category, content: originContext.content,
          sourceType: originContext.source_type, sourceId: originContext.source_id } : null,
        confirmed: row.confirmed === true, confirmedByUid: row.confirmed_by_uid || null,
        updatedAt: latest(row.last_verified_at, row.confirmed_at, row.created_at),
        validFrom: row.valid_from || null, validTo: row.valid_to || null, validity,
        needsReview: row.item_type === 'fact' && classification.isConflict(row),
        lifecycle: audit ? audit.operation : null, auditAt: audit?.executed_at || null,
        supersededBy: audit?.result?.newItemId || null,
      });
    }
    return { groups, testData: await this.disclose(refs) };
  }
}
module.exports = { PersonInsightsService };
