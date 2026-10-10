'use strict';

const { PersonService } = require('./person-service');

const STAGES = new Set(['new', 'contacted', 'cooperated', 'stable', 'deep', 'inactive']);
const STATUSES = new Set(['active', 'inactive']);
const TEXT_FIELDS = ['position', 'expertise', 'topic_summary', 'source', 'last_contact_note',
  'preferred_format', 'notes'];
const DATE_FIELDS = ['last_contact_date', 'next_contact_date'];

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid Speaker or Person ID');
  }
  return id;
}

function profileData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Speaker profile');
  const profile = {};
  for (const field of TEXT_FIELDS) {
    if (data[field] == null || data[field] === '') continue;
    if (typeof data[field] !== 'string' || data[field].length > 4000) {
      throw new Error('Invalid Speaker profile field');
    }
    profile[field] = data[field];
  }
  for (const field of DATE_FIELDS) {
    if (data[field] == null || data[field] === '') continue;
    if (typeof data[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data[field])) {
      throw new Error('Invalid Speaker profile date');
    }
    profile[field] = data[field];
  }
  if (data.relationship_stage != null) {
    if (!STAGES.has(data.relationship_stage)) throw new Error('Invalid Speaker relationship stage');
    profile.relationship_stage = data.relationship_stage;
  }
  if (data.status != null) {
    if (!STATUSES.has(data.status)) throw new Error('Invalid Speaker status');
    profile.status = data.status;
  }
  if (data.cooperation_count != null && data.cooperation_count !== '') {
    const count = Number(data.cooperation_count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Speaker cooperation count');
    profile.cooperation_count = count;
  }
  return profile;
}

class SpeakerProfileService {
  constructor({ request }) {
    if (typeof request !== 'function') throw new Error('Invalid Speaker service');
    this.request = request;
    this.personService = new PersonService({ request });
  }

  async confirmedPerson(data, uid) {
    if (!uid || data?.confirmed !== true) throw new Error('Human confirmation is required');
    const personId = idOf(data.personId);
    if (typeof data.selectedDisplayName !== 'string') throw new Error('Selected Person is required');
    const resolved = await this.personService.resolveName(data.selectedDisplayName);
    if (!resolved.candidates.some(candidate => candidate.id === personId &&
        candidate.displayName === data.selectedDisplayName)) {
      throw new Error('Selected Person changed; resolve identity again');
    }
    const people = await this.request('persons', 'GET', {
      select: 'id,display_name,phone,wechat,organization,occupation',
      id: `eq.${personId}`, deleted_at: 'is.null', limit: 1,
    });
    if (people.length !== 1 || people[0].display_name !== data.selectedDisplayName) {
      throw new Error('Selected Person changed; resolve identity again');
    }
    return people[0];
  }

  async activeCustomerId(person) {
    // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
    const customers = await this.request('customers', 'GET', {
      select: 'Id', person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null', limit: 1,
    });
    return customers.length === 1 ? Number(customers[0].Id) : null;
  }

  async create(data, uid) {
    const person = await this.confirmedPerson(data, uid);
    const existing = await this.request('activity_speakers', 'GET', {
      select: 'id', person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null', limit: 1,
    });
    if (existing.length) throw new Error('Speaker profile already exists for this Person');
    const customerId = await this.activeCustomerId(person);
    if (customerId != null) {
      const legacy = await this.request('activity_speakers', 'GET', {
        select: 'id', customer_id: `eq.${customerId}`, deleted_at: 'is.null', limit: 1,
      });
      if (legacy.length) throw new Error('Speaker profile already exists for this customer; link the existing profile');
    }
    const now = new Date().toISOString();
    const rows = await this.request('activity_speakers', 'POST', {}, {
      ...profileData(data.profile), person_id: Number(person.id),
      name: person.display_name, phone: person.phone || null,
      wechat: person.wechat || null, organization: person.organization || null,
      customer_id: customerId,
      created_at: now, updated_at: now,
    });
    if (rows.length !== 1) throw new Error('Speaker profile could not be saved');
    return { id: rows[0].id, personId: idOf(person.id), customerId };
  }

  async link(data, uid) {
    const person = await this.confirmedPerson(data, uid);
    const speakerId = idOf(data.speakerId);
    const rows = await this.request('activity_speakers', 'GET', {
      select: 'id,name,person_id,customer_id', id: `eq.${speakerId}`,
      deleted_at: 'is.null', limit: 1,
    });
    const speaker = rows[0];
    if (!speaker) throw new Error('Speaker profile not found');
    if (speaker.person_id != null) throw new Error('Speaker profile already linked to a Person');
    const existing = await this.request('activity_speakers', 'GET', {
      select: 'id', person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null', limit: 1,
    });
    if (existing.length) throw new Error('Speaker profile already exists for this Person');
    const customerId = await this.activeCustomerId(person);
    if (speaker.customer_id != null && String(speaker.customer_id) !== String(customerId)) {
      throw new Error('Speaker customer belongs to another Person');
    }
    if (speaker.customer_id == null && speaker.name !== person.display_name) {
      throw new Error('Speaker name differs from selected Person');
    }
    const saved = await this.request('activity_speakers', 'PATCH', {
      id: `eq.${speakerId}`, person_id: 'is.null', deleted_at: 'is.null',
    }, {
      person_id: Number(person.id), customer_id: customerId,
      updated_at: new Date().toISOString(),
    });
    if (saved.length !== 1) throw new Error('Speaker profile changed; retry linking');
    return { ok: true, personId: idOf(person.id) };
  }
}

module.exports = { SpeakerProfileService, profileData };
