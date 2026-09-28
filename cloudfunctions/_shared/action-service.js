/** Person-level actions. Source module only; no existing Function imports it yet. */
'use strict';

const COLUMNS = 'id,person_id,opportunity_id,interaction_id,activity_id,action_type,title,description,due_at,priority,status,source,urgency_score,impact_score,confidence_score,effort_score,priority_score,completed_at,created_at,updated_at,created_by_uid,completed_by_uid';
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const SCORE_FIELDS = ['urgency_score', 'impact_score', 'confidence_score', 'effort_score', 'priority_score'];
const MAX_LIMIT = 50;

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid action reference ID');
  }
  return id;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

function requiredText(value, limit, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

function optionalText(value, limit, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid ${field}`);
  return value;
}

function instant(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new Error('Invalid due_at');
  return new Date(value).toISOString();
}

function score(value, field) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      value < 0 || value > 100 || Math.abs(Math.round(value * 100) - value * 100) > 1e-8) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

class ActionService {
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
    const value = options.limit == null ? 20 : Number(options.limit);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      throw new Error('Invalid action limit');
    }
    if (options.includeClosed != null && typeof options.includeClosed !== 'boolean') {
      throw new Error('Invalid includeClosed');
    }
    const person = await this.findPerson(personId);
    const filters = {
      select: COLUMNS, person_id: `eq.${idOf(person.id)}`,
      order: 'due_at.asc.nullslast,id.desc', limit: value,
    };
    if (!options.includeClosed) filters.status = 'in.(open,in_progress)';
    const rows = await this.request('actions', 'GET', filters);
    if (!Array.isArray(rows)) throw new Error('Invalid action response');
    return { rows, limit: value };
  }

  async createManual(personId, data, uid) {
    const actor = requiredText(uid, 128, 'actor');
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid action data');
    }
    if (data.source != null && data.source !== 'manual') {
      throw new Error('Manual actions cannot use an AI or legacy source');
    }
    const actionType = requiredText(data.action_type, 64, 'action_type');
    const title = requiredText(data.title, 200, 'title');
    const description = optionalText(data.description, 4000, 'description');
    const dueAt = instant(data.due_at);
    const priority = data.priority == null ? 'medium' : data.priority;
    if (!PRIORITIES.has(priority)) throw new Error('Invalid priority');
    const scores = Object.fromEntries(SCORE_FIELDS.map(field => [field, score(data[field], field)]));
    const person = await this.findPerson(personId);
    let opportunityId = null;
    let interactionId = null;
    let activityId = null;
    if (data.opportunity_id != null) {
      opportunityId = idOf(data.opportunity_id);
      const direct = one(await this.request('opportunities', 'GET', {
        select: 'id', id: `eq.${opportunityId}`,
        person_id: `eq.${idOf(person.id)}`, deleted_at: 'is.null', limit: 1,
      }));
      const legacy = direct || person.legacy_customer_id == null ? null :
        one(await this.request('opportunities', 'GET', {
          select: 'id', id: `eq.${opportunityId}`,
          customer_id: `eq.${idOf(person.legacy_customer_id)}`,
          deleted_at: 'is.null', limit: 1,
        }));
      if (!direct && !legacy) throw new Error('Opportunity not found for Person');
    }
    if (data.interaction_id != null) {
      interactionId = idOf(data.interaction_id);
      if (!one(await this.request('interactions', 'GET', {
        select: 'id', id: `eq.${interactionId}`,
        person_id: `eq.${idOf(person.id)}`, limit: 1,
      }))) throw new Error('Interaction not found for Person');
    }
    if (data.activity_id != null) {
      activityId = idOf(data.activity_id);
      if (!one(await this.request('activities', 'GET', {
        select: 'id', id: `eq.${activityId}`, deleted_at: 'is.null', limit: 1,
      }))) throw new Error('Activity not found');
    }
    const saved = one(await this.request('actions', 'POST', {}, {
      person_id: Number(person.id), opportunity_id: opportunityId == null ? null : Number(opportunityId),
      interaction_id: interactionId == null ? null : Number(interactionId),
      activity_id: activityId == null ? null : Number(activityId),
      action_type: actionType, title, description, due_at: dueAt, priority,
      status: 'open', source: 'manual', ...scores, created_by_uid: actor,
    }));
    if (!saved) throw new Error('Action could not be saved');
    return { action: saved };
  }

  async complete(personId, actionId, uid) {
    const actor = requiredText(uid, 128, 'actor');
    const person = await this.findPerson(personId);
    const saved = one(await this.request('actions', 'PATCH', {
      id: `eq.${idOf(actionId)}`, person_id: `eq.${idOf(person.id)}`,
      status: 'in.(open,in_progress)',
    }, { status: 'completed', completed_at: new Date().toISOString(), completed_by_uid: actor }));
    if (!saved) throw new Error('Open action not found');
    return { action: saved };
  }
}

module.exports = { ActionService };
