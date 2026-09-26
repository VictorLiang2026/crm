/** Person interaction ledger with bounded, read-through legacy sources. */
'use strict';

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

function excerpt(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, 2000);
}

function legacy(sourceType, row, at, summary, rawNote, channel, activityId) {
  if (!at) return null;
  const sourceId = sourceType === 'followups' ? row.Id : row.id;
  return {
    id: `${sourceType}:${idOf(sourceId)}`, interaction_type: sourceType === 'activity_participants' ?
      'activity_participation' : sourceType === 'followups' ? 'followup' : 'recruit_followup',
    interaction_at: at, channel: channel || null, summary,
    raw_note: typeof rawNote === 'string' ? rawNote.slice(0, 10000) || null : null,
    activity_id: activityId || null,
    source_type: sourceType, source_id: sourceId, importance: 3,
    created_at: timestamp(row.created_at), virtual: true,
  };
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
      const customerId = idOf(person.legacy_customer_id);
      const [followups, candidates] = await Promise.all([
        this.request('followups', 'GET', {
          select: 'Id,followup_date,created_at,interaction_summary,followup_notes,activity_id',
          customer_id: `eq.${customerId}`, deleted_at: 'is.null',
          order: 'followup_date.desc,Id.desc', limit: MAX_LIMIT,
        }),
        this.request('recruit_candidates', 'GET', {
          select: 'id,customer_id', customer_id: `eq.${customerId}`,
          deleted_at: 'is.null', limit: 10,
        }),
      ]);
      for (const f of followups) {
        const note = f.followup_notes || null;
        const item = legacy('followups', f, timestamp(f.followup_date || f.created_at),
          excerpt(f.interaction_summary || note, '客户跟进'), note, null, f.activity_id);
        if (item) rows.push(item);
      }
      const candidateIds = candidates.map(row => idOf(row.id));
      const [recruitFollowups, customerParticipants, recruitParticipants, customerSpeakers, recruitSpeakers] = await Promise.all([
        candidateIds.length ? this.request('recruit_followups', 'GET', {
          select: 'id,candidate_id,followup_date,created_at,interaction_summary,followup_notes,contact_method',
          candidate_id: `in.(${candidateIds.join(',')})`, deleted_at: 'is.null',
          order: 'followup_date.desc,id.desc', limit: MAX_LIMIT,
        }) : [],
        this.participants('customer', [customerId]),
        this.participants('recruit', candidateIds),
        this.request('activity_speakers', 'GET', {
          select: 'id,customer_id,recruit_candidate_id', customer_id: `eq.${customerId}`,
          deleted_at: 'is.null', limit: MAX_LIMIT,
        }),
        candidateIds.length ? this.request('activity_speakers', 'GET', {
          select: 'id,customer_id,recruit_candidate_id',
          recruit_candidate_id: `in.(${candidateIds.join(',')})`,
          deleted_at: 'is.null', limit: MAX_LIMIT,
        }) : [],
      ]);
      for (const f of recruitFollowups) {
        const note = f.followup_notes || null;
        const item = legacy('recruit_followups', f, timestamp(f.followup_date || f.created_at),
          excerpt(f.interaction_summary || note, '增员跟进'), note, f.contact_method, null);
        if (item) rows.push(item);
      }
      const speakerIds = [...new Map([...customerSpeakers, ...recruitSpeakers]
        .filter(s => s.customer_id == null || String(s.customer_id) === customerId)
        .filter(s => s.recruit_candidate_id == null || candidateIds.includes(String(s.recruit_candidate_id)))
        .map(s => [String(s.id), idOf(s.id)])).values()];
      const speakerParticipants = await this.participants('speaker', speakerIds);
      const participants = [...customerParticipants, ...recruitParticipants, ...speakerParticipants];
      const activityIds = [...new Set(participants.map(p => idOf(p.activity_id)))];
      const activities = activityIds.length ? await this.request('activities', 'GET', {
        select: 'id,name,activity_date', id: `in.(${activityIds.join(',')})`,
        deleted_at: 'is.null', limit: MAX_LIMIT * 3,
      }) : [];
      const activityMap = new Map(activities.map(a => [String(a.id), a]));
      for (const p of participants) {
        const activity = activityMap.get(String(p.activity_id));
        if (!activity) continue;
        const item = legacy('activity_participants', p,
          timestamp(activity.activity_date || p.created_at),
          excerpt(`参加活动：${activity.name || ''}`, '参加活动'),
          p.relationship_note, 'activity', p.activity_id);
        if (item) rows.push(item);
      }
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

  async participants(personType, ids) {
    if (!ids.length) return [];
    return this.request('activity_participants', 'GET', {
      select: 'id,activity_id,person_type,person_id,status,relationship_note,created_at',
      person_type: `eq.${personType}`, person_id: `in.(${ids.join(',')})`,
      status: 'eq.attended', deleted_at: 'is.null',
      order: 'created_at.desc,id.desc', limit: MAX_LIMIT,
    });
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
