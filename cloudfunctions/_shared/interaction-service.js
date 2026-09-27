/** Person interaction ledger with bounded, read-through legacy sources. */
'use strict';

const { LegacyInteractionAdapter } = require('./legacy-interaction-adapter');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid Person ID');
  }
  return id;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

function listLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new Error('Invalid interaction limit');
  return n;
}

function timestamp(value) {
  if (!value) return null;
  const text = String(value);
  const full = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+08:00` : text;
  return Number.isFinite(Date.parse(full)) ? new Date(full).toISOString() : null;
}

class InteractionService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
  }

  async findPerson(personId) {
    const person = one(await this.request('persons', 'GET', {
      select: 'id,legacy_customer_id', id: `eq.${idOf(personId)}`,
      deleted_at: 'is.null', limit: 1,
    }));
    if (!person) throw new Error('Person not found');
    return person;
  }

  async listForPerson(personId, options = {}) {
    const limit = listLimit(options.limit);
    const person = await this.findPerson(personId);
    const stored = await this.request('interactions', 'GET', {
      select: 'id,person_id,interaction_type,interaction_at,channel,summary,raw_note,activity_id,source_type,source_id,importance,created_at',
      person_id: `eq.${idOf(person.id)}`, order: 'interaction_at.desc,id.desc', limit: MAX_LIMIT,
    });
    const rows = stored.map(item => ({ ...item, virtual: false }));
    if (person.legacy_customer_id != null) {
      rows.push(...await new LegacyInteractionAdapter({ request: this.request })
        .listForCustomer(person.legacy_customer_id));
    }
    // A future import may materialize a legacy source. Show it once, preferring the ledger row.
    const seen = new Set();
    const unique = rows.filter(row => {
      const key = row.source_id == null ? `manual:${row.id}` : `${row.source_type}:${row.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => Date.parse(b.interaction_at) - Date.parse(a.interaction_at) ||
      String(b.id).localeCompare(String(a.id)));
    return { rows: unique.slice(0, limit), limit, hasMore: unique.length > limit };
  }

  async createManual(personId, data, uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('UNAUTHORIZED');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid interaction data');
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const type = typeof data.interaction_type === 'string' ? data.interaction_type.trim() : '';
    const channel = data.channel == null ? null : data.channel;
    const rawNote = data.raw_note == null ? null : data.raw_note;
    const at = timestamp(data.interaction_at);
    const importance = data.importance == null ? 3 : Number(data.importance);
    if (!summary || summary.length > 2000 || !type || type.length > 64 ||
        !at || (channel != null && (typeof channel !== 'string' || channel.length > 100)) ||
        (rawNote != null && (typeof rawNote !== 'string' || rawNote.length > 10000)) ||
        !Number.isInteger(importance) || importance < 1 || importance > 5) {
      throw new Error('Invalid interaction data');
    }
    // A date-only value would silently assume a timezone; manual capture needs an explicit instant.
    if (typeof data.interaction_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.interaction_at)) {
      throw new Error('Invalid interaction time');
    }
    const person = await this.findPerson(personId);
    let activityId = null;
    if (data.activity_id != null) {
      activityId = idOf(data.activity_id);
      const activity = one(await this.request('activities', 'GET', {
        select: 'id', id: `eq.${activityId}`, deleted_at: 'is.null', limit: 1,
      }));
      if (!activity) throw new Error('Activity not found');
    }
    const saved = one(await this.request('interactions', 'POST', {}, {
      person_id: Number(person.id), interaction_type: type, interaction_at: at,
      channel: channel?.trim() || null, summary, raw_note: rawNote || null,
      activity_id: activityId == null ? null : Number(activityId),
      source_type: 'manual', source_id: null, importance, created_by_uid: uid.trim(),
    }));
    if (!saved) throw new Error('Interaction could not be saved');
    return { interaction: saved };
  }
}

module.exports = { InteractionService };
