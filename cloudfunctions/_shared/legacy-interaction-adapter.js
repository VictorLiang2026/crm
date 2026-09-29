/** Read-only projection of active legacy CRM records into interaction rows. */
'use strict';

const MAX_LIMIT = 50;

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid Person ID');
  }
  return id;
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

function representation(sourceType, row, at, summary, rawNote, channel, activityId) {
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

class LegacyInteractionAdapter {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
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

  async listCanonicalAttended(personId) {
    const personKey = idOf(personId);
    const direct = await this.request('activity_participants', 'GET', {
      select: 'id,activity_id,person_type,person_id,canonical_person_id,status,relationship_note,created_at',
      canonical_person_id: `eq.${personKey}`, status: 'eq.attended',
      deleted_at: 'is.null', order: 'created_at.desc,id.desc', limit: MAX_LIMIT,
    });
    const speakerProfiles = await this.request('activity_speakers', 'GET', {
      select: 'id,person_id', person_id: `eq.${personKey}`,
      deleted_at: 'is.null', limit: MAX_LIMIT,
    });
    const speakerIds = speakerProfiles.map(row => idOf(row.id));
    const speakerAttendance = speakerIds.length ? await this.participants('speaker', speakerIds) : [];
    const participants = [...new Map([...direct, ...speakerAttendance]
      .map(row => [String(row.id), row])).values()];
    const ids = [...new Set(participants.map(row => idOf(row.activity_id)))];
    const activities = ids.length ? await this.request('activities', 'GET', {
      select: 'id,name,activity_date', id: `in.(${ids.join(',')})`,
      deleted_at: 'is.null', limit: MAX_LIMIT * 2,
    }) : [];
    const activityMap = new Map(activities.map(row => [String(row.id), row]));
    return participants.flatMap(row => {
      const activity = activityMap.get(String(row.activity_id));
      if (!activity) return [];
      const item = representation('activity_participants', row,
        timestamp(activity.activity_date || row.created_at),
        excerpt(`参加活动：${activity.name || ''}`, '参加活动'),
        row.relationship_note, 'activity', row.activity_id);
      return item ? [item] : [];
    });
  }

  async listForCustomer(legacyCustomerId) {
    const customerId = idOf(legacyCustomerId);
    const rows = [];
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
      const item = representation('followups', f, timestamp(f.followup_date || f.created_at),
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
      const item = representation('recruit_followups', f, timestamp(f.followup_date || f.created_at),
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
      const item = representation('activity_participants', p,
        timestamp(activity.activity_date || p.created_at),
        excerpt(`参加活动：${activity.name || ''}`, '参加活动'),
        p.relationship_note, 'activity', p.activity_id);
      if (item) rows.push(item);
    }
    return rows;
  }
}

module.exports = { LegacyInteractionAdapter };
