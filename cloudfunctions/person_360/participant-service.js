'use strict';

const { PersonService } = require('./person-service');

const TYPES = new Set(['customer', 'recruit', 'speaker']);
const STATUSES = new Set(['invited', 'attended', 'absent']);

function idOf(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error('Invalid participant ID');
  }
  return text;
}

class ParticipantService {
  constructor({ request }) {
    if (typeof request !== 'function') throw new Error('Invalid participant service');
    this.request = request;
    this.personService = new PersonService({ request });
  }

  async legacyId(person, type) {
    if (person.legacy_customer_id == null) return null;
    const customerId = idOf(person.legacy_customer_id);
    if (type === 'customer') {
      const rows = await this.request('customers', 'GET', {
        select: 'Id', Id: `eq.${customerId}`, deleted_at: 'is.null', limit: 1,
      });
      return rows.length === 1 ? customerId : null;
    }
    const table = type === 'recruit' ? 'recruit_candidates' : 'activity_speakers';
    const rows = await this.request(table, 'GET', {
      select: 'id,customer_id', customer_id: `eq.${customerId}`,
      deleted_at: 'is.null', limit: 2,
    });
    return rows.length === 1 ? idOf(rows[0].id) : null;
  }

  async add(data, uid) {
    if (!uid || data?.confirmed !== true) throw new Error('Human confirmation is required');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid participant data');
    const activityId = idOf(data.activityId);
    const personId = idOf(data.canonicalPersonId);
    if (!TYPES.has(data.personType)) throw new Error('Invalid participant type');
    const status = data.status || 'invited';
    if (!STATUSES.has(status)) throw new Error('Invalid participant status');
    const note = data.relationshipNote == null ? '' : data.relationshipNote;
    if (typeof note !== 'string' || note.length > 4000) throw new Error('Invalid participant note');
    if (typeof data.selectedDisplayName !== 'string') throw new Error('Selected Person is required');

    const resolution = await this.personService.resolveName(data.selectedDisplayName);
    if (!resolution.candidates.some(candidate => candidate.id === personId &&
        candidate.displayName === data.selectedDisplayName)) {
      throw new Error('Selected Person changed; resolve identity again');
    }
    const activities = await this.request('activities', 'GET', {
      select: 'id', id: `eq.${activityId}`, deleted_at: 'is.null', limit: 1,
    });
    if (activities.length !== 1) throw new Error('Activity not found');
    const people = await this.request('persons', 'GET', {
      select: 'id,display_name,legacy_customer_id', id: `eq.${personId}`,
      deleted_at: 'is.null', limit: 1,
    });
    const person = people[0];
    if (!person || person.display_name !== data.selectedDisplayName) {
      throw new Error('Selected Person changed; resolve identity again');
    }
    const canonicalDuplicates = await this.request('activity_participants', 'GET', {
      select: 'id', activity_id: `eq.${activityId}`,
      canonical_person_id: `eq.${personId}`, deleted_at: 'is.null', limit: 1,
    });
    if (canonicalDuplicates.length) throw new Error('Participant already added');

    const legacyId = await this.legacyId(person, data.personType);
    if (legacyId) {
      const legacyDuplicates = await this.request('activity_participants', 'GET', {
        select: 'id', activity_id: `eq.${activityId}`,
        person_type: `eq.${data.personType}`, person_id: `eq.${legacyId}`,
        deleted_at: 'is.null', limit: 1,
      });
      if (legacyDuplicates.length) throw new Error('Participant already added');
    }
    const rows = await this.request('activity_participants', 'POST', {}, {
      activity_id: Number(activityId), person_type: data.personType,
      person_id: legacyId ? Number(legacyId) : null,
      canonical_person_id: Number(personId), person_name: person.display_name,
      status, relationship_note: note || null,
      participant_role: data.personType === 'speaker' ? 'speaker' : 'attendee',
      followup_status: 'none',
    });
    if (rows.length !== 1) throw new Error('Participant could not be saved');
    return { id: rows[0].id, linked: true, canonicalPersonId: personId, legacyLinked: !!legacyId };
  }
}

module.exports = { ParticipantService };
