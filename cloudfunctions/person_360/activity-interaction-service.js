'use strict';

const MIN_IMPORTANCE = Object.freeze({
  invitation: 3,
  conversation: 3,
  speaker_cooperation: 4,
  post_event_followup: 3,
});
const EVIDENCE = Object.freeze({
  invitation: new Set(['replied', 'accepted', 'declined', 'next_step']),
  conversation: new Set(['need', 'decision', 'commitment', 'relationship']),
  speaker_cooperation: new Set(['topic', 'format', 'agreement', 'delivery']),
  post_event_followup: new Set(['contacted', 'response', 'next_step', 'closed']),
});

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid activity identity');
  return id;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

class ActivityInteractionService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Invalid activity interaction service');
    this.request = request;
  }

  async personFor(participant) {
    let personId = participant.canonical_person_id;
    let customerId = null;
    if (!personId && participant.person_id != null) {
      if (participant.person_type === 'customer') customerId = idOf(participant.person_id);
      if (participant.person_type === 'recruit') {
        const candidate = one(await this.request('recruit_candidates', 'GET', {
          select: 'id,person_id,customer_id', id: `eq.${idOf(participant.person_id)}`,
          deleted_at: 'is.null', limit: 1,
        }));
        personId = candidate?.person_id;
        customerId = candidate?.customer_id;
      }
      if (participant.person_type === 'speaker') {
        const speaker = one(await this.request('activity_speakers', 'GET', {
          select: 'id,person_id,customer_id', id: `eq.${idOf(participant.person_id)}`,
          deleted_at: 'is.null', limit: 1,
        }));
        personId = speaker?.person_id;
        customerId = speaker?.customer_id;
      }
    }
    // PMC-19 CL-03: legacy_customer_id removed; resolve person via customers.person_id
    if (!personId && customerId) {
      const customer = one(await this.request('customers', 'GET', {
        select: 'Id,person_id', Id: `eq.${idOf(customerId)}`, deleted_at: 'is.null', limit: 1,
      }));
      personId = customer?.person_id;
    }
    if (!personId) throw new Error('Participant has no confirmed Person identity');
    const person = one(await this.request('persons', 'GET', {
      select: 'id,display_name', id: `eq.${idOf(personId)}`, deleted_at: 'is.null', limit: 2,
    }));
    if (!person) throw new Error('Participant has no active Person identity');
    return person;
  }

  async record(data, uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('UNAUTHORIZED');
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.confirmed !== true) {
      throw new Error('Human confirmation is required');
    }
    const type = data.eventType;
    if (type === 'attendance') throw new Error('Attendance is already shown from the participant record');
    if (!Object.hasOwn(MIN_IMPORTANCE, type)) throw new Error('Invalid activity event type');
    const importance = Number(data.importance);
    if (!Number.isInteger(importance) || importance < MIN_IMPORTANCE[type] || importance > 5) {
      throw new Error('Activity event importance is below the required threshold');
    }
    if (!EVIDENCE[type].has(data.evidence)) throw new Error('Activity event needs a concrete outcome');
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    if (summary.length < 12 || summary.length > 2000) throw new Error('Activity event needs a substantive summary');
    const at = typeof data.interactionAt === 'string' ? data.interactionAt : '';
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) {
      throw new Error('Invalid activity event time');
    }
    const channel = data.channel == null ? '' : data.channel;
    if (typeof channel !== 'string' || channel.length > 100) throw new Error('Invalid activity event channel');
    const activityId = idOf(data.activityId);
    const participantId = idOf(data.participantId);
    const participant = one(await this.request('activity_participants', 'GET', {
      select: 'id,activity_id,person_type,person_id,canonical_person_id,participant_role,status',
      id: `eq.${participantId}`, activity_id: `eq.${activityId}`,
      deleted_at: 'is.null', limit: 1,
    }));
    if (!participant) throw new Error('Participant not found');
    if (type === 'speaker_cooperation' && participant.person_type !== 'speaker' && participant.participant_role !== 'speaker') {
      throw new Error('Speaker cooperation requires a speaker participant');
    }
    const activity = one(await this.request('activities', 'GET', {
      select: 'id,name,status', id: `eq.${activityId}`, deleted_at: 'is.null', limit: 1,
    }));
    if (!activity) throw new Error('Activity not found');
    if (type === 'post_event_followup' && !['ended', 'reviewed'].includes(activity.status)) {
      throw new Error('Post-event followup requires an ended activity');
    }
    const person = await this.personFor(participant);
    const instant = new Date(at).toISOString();
    if (type === 'post_event_followup') {
      // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
      const customer = one(await this.request('customers', 'GET', {
        select: 'Id', person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null', limit: 1,
      }));
      if (customer) {
        const legacy = await this.request('followups', 'GET', {
          select: 'Id,interaction_summary,followup_notes',
          customer_id: `eq.${idOf(customer.Id)}`,
          activity_id: `eq.${activityId}`, deleted_at: 'is.null', limit: 50,
        });
        if (legacy.some(row => [row.interaction_summary, row.followup_notes]
          .some(value => typeof value === 'string' && value.trim() === summary))) {
          throw new Error('Activity event already exists as a followup');
        }
      }
    }
    const duplicates = await this.request('interactions', 'GET', {
      select: 'id,summary', person_id: `eq.${idOf(person.id)}`,
      activity_id: `eq.${activityId}`, interaction_type: `eq.${type}`,
      interaction_at: `eq.${instant}`, source_type: 'eq.manual', limit: 10,
    });
    if (duplicates.some(row => row.summary === summary)) throw new Error('Activity event already recorded');
    const saved = one(await this.request('interactions', 'POST', {}, {
      person_id: Number(person.id), activity_id: Number(activityId), interaction_type: type,
      interaction_at: instant, channel: channel.trim() || null, summary,
      raw_note: `outcome:${data.evidence}`, source_type: 'manual', source_id: null,
      importance, created_by_uid: uid.trim(),
    }));
    if (!saved) throw new Error('Activity event could not be saved');
    return { interaction: saved, personId: String(person.id) };
  }
}

module.exports = { ActivityInteractionService, MIN_IMPORTANCE };
