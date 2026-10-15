/** Read-through, bounded Person 360 timeline and context. No legacy backfill. */
'use strict';
const { InteractionService } = require('./interaction-service');
const { LegacyInteractionAdapter } = require('./legacy-interaction-adapter');
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
const sourceKey = row => row.source_id == null ? `interactions:${row.id}` : `${row.source_type}:${row.source_id}`;
const at = row => Date.parse(row.interaction_at) || 0;
const LEGACY_SOURCES = new Set(['followups', 'recruit_followups', 'activity_participants']);
const latest = (...values) => values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

class PersonInsightsService {
  constructor({ request, disclose = testData.disclose } = {}) {
    if (typeof request !== 'function') throw Error('Authorized database request is required');
    this.request = request;
    this.disclose = disclose;
  }

  // Legacy Adapter caps each source query at 50. Read additional source pages here,
  // before merging and deduplicating, so page 2 never repeats or silently skips rows.
  boundedRead() {
    return async (table, method, filters = {}, body) => {
      if (method !== 'GET') throw Error('Invalid source operation');
      if (!['interactions', 'followups', 'recruit_followups', 'activity_participants', 'activity_speakers', 'recruit_candidates'].includes(table)) {
        return this.request(table, method, filters, body);
      }
      const rows = [];
      const cap = 401;
      while (rows.length < cap) {
        const limit = Math.min(50, cap - rows.length);
        const batch = await this.request(table, 'GET', { ...filters,
          order: filters.order || (table === 'recruit_candidates' || table === 'activity_speakers' ? 'id.asc' : undefined),
          limit, offset: rows.length });
        rows.push(...batch);
        if (batch.length < limit) break;
      }
      if (rows.length === cap) throw Error('Timeline read limit reached');
      return rows;
    };
  }

  async timeline(personId, options = {}) {
    const page = safePage(options.page), pageSize = safeSize(options.pageSize);
    const id = idOf(personId);
    const read = this.boundedRead();
    const person = await new InteractionService({ request: read }).findPerson(id);
    // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
    const customer = (await read('customers', 'GET', { select: 'Id', person_id: `eq.${id}`,
      deleted_at: 'is.null', limit: 1 }))[0] || null;
    const customerId = customer?.Id ?? null;
    const adapter = new LegacyInteractionAdapter({ request: read });
    const stored = await read('interactions', 'GET', {
      select: 'id,person_id,interaction_type,interaction_at,channel,summary,raw_note,activity_id,source_type,source_id,created_at',
      person_id: `eq.${id}`, order: 'interaction_at.desc,id.desc', limit: 50,
    });
    const virtual = [];
    if (customerId != null) virtual.push(...await adapter.listForCustomer(String(customerId), id));
    virtual.push(...await adapter.listCanonicalAttended(id));
    if (customerId == null) {
      const candidates = await read('recruit_candidates', 'GET', {
        select: 'id,person_id', person_id: `eq.${id}`, deleted_at: 'is.null', limit: 50,
      });
      if (candidates.length) {
        const follows = await read('recruit_followups', 'GET', {
          select: 'id,candidate_id,followup_date,created_at,interaction_summary,followup_notes,contact_method',
          candidate_id: `in.(${candidates.map(row => idOf(row.id)).join(',')})`, deleted_at: 'is.null',
          order: 'followup_date.desc,id.desc', limit: 50,
        });
        for (const row of follows) virtual.push({
          id: `recruit_followups:${row.id}`, interaction_type: 'recruit_followup',
          interaction_at: row.followup_date || row.created_at, channel: row.contact_method || null,
          summary: row.interaction_summary || row.followup_notes || '增员跟进',
          source_type: 'recruit_followups', source_id: row.id, candidate_id: row.candidate_id, virtual: true,
        });
      }
    }
    // The original legacy row is authoritative. An imported ledger copy cannot
    // resurrect a deleted followup or show stale text after the old editor saves.
    const activeLegacy = new Set(virtual.map(sourceKey));
    const rows = [...stored.filter(row => !LEGACY_SOURCES.has(row.source_type) || activeLegacy.has(sourceKey(row))), ...virtual];
    const unique = [...new Map(rows.map(row => [sourceKey(row), row])).values()];
    unique.sort((a, b) => at(b) - at(a) || String(b.id).localeCompare(String(a.id)));
    const pageRows = unique.slice((page - 1) * pageSize, page * pageSize).map(row => ({
      id: row.id, type: row.interaction_type, at: row.interaction_at,
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
        id: `in.(${interactionIds.join(',')})`, person_id: `eq.${id}`, limit: 45,
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
