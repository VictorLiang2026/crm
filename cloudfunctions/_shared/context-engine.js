/** Bounded, read-only public-schema context for AI tasks. No model or business writes. */
'use strict';

const VERSION = '1.0.0';
const LIMITS = Object.freeze({ interactions: 5, interactionsMax: 10, opportunities: 5,
  products: 5, reports: 3, participants: 20, tasks: 20, actions: 20, goals: 5 });
const FIELDS = Object.freeze({
  customers: ['Id', 'customer_name', 'occupation', 'customer_stage', 'sales_priority', 'next_action', 'next_action_date'],
  followups: ['Id', 'customer_id', 'followup_date', 'interaction_summary', 'followup_notes', 'next_action', 'next_action_date', 'next_followup_date'],
  opportunities: ['id', 'customer_id', 'opportunity_type', 'status', 'last_progress', 'next_action', 'next_action_date'],
  products: ['id', 'customer_id', 'items', 'created_at'],
  policy_review_reports: ['id', 'customer_id', 'report_date', 'report_type', 'edited_summary', 'summary', 'next_action'],
  activities: ['id', 'name', 'activity_date', 'activity_type', 'status', 'review_summary', 'review_notes', 'review_score'],
  activity_participants: ['id', 'activity_id', 'person_type', 'person_id', 'person_name', 'status', 'participant_role', 'followup_status'],
  activity_tasks: ['id', 'activity_id', 'task_title', 'status', 'priority', 'due_date', 'completed_at'],
  recruit_candidates: ['id', 'customer_id', 'stage', 'motivation', 'concerns', 'potential_score', 'next_action', 'next_action_date'],
  recruit_followups: ['id', 'candidate_id', 'followup_date', 'interaction_summary', 'followup_notes', 'next_action', 'next_action_date'],
});
const IDS = Object.freeze({ customers: 'Id', followups: 'Id' });

class ContextError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function idOf(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value))) {
    throw new ContextError('INVALID_SUBJECT', 'subjectId must be a positive integer');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new ContextError('INVALID_SUBJECT', 'subjectId is out of range');
  return id;
}

function dayOf(value) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ContextError('INVALID_SUBJECT', 'subjectId must be a valid YYYY-MM-DD date');
  }
  return value;
}

function cap(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ContextError('INVALID_OPTIONS', `limit must be between 1 and ${max}`);
  }
  return value;
}

function bounded(value) {
  if (typeof value === 'string') return value.slice(0, 600);
  if (Array.isArray(value)) return value.slice(0, 8).map(bounded);
  if (value && typeof value === 'object') return null; // Never forward unbounded JSON columns.
  return value;
}

function createContextEngine({ rdb, now = () => new Date() } = {}) {
  if (!rdb || typeof rdb.from !== 'function') throw new ContextError('INVALID_CONFIG', 'CloudBase RDB is required');

  async function read(table, filters, { order, limit = 1, one = false } = {}) {
    if (!Object.hasOwn(FIELDS, table)) throw new ContextError('INVALID_CONFIG', 'Unknown context source');
    let query = rdb.from(table).select(FIELDS[table].join(','));
    for (const [column, value] of Object.entries(filters || {})) {
      if (!FIELDS[table].includes(column) && column !== 'deleted_at') {
        throw new ContextError('INVALID_CONFIG', 'Unknown context filter');
      }
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    if (order) query = query.order(order, { ascending: false });
    query = query.limit(limit);
    let response;
    try { response = await query; }
    catch (error) { throw new ContextError('READ_FAILED', `Context read failed: ${table}`, error); }
    if (!response || response.error) throw new ContextError('READ_FAILED', `Context read failed: ${table}`, response?.error);
    const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    if (rows.length > limit) throw new ContextError('READ_FAILED', `Context read exceeded limit: ${table}`);
    const wrapped = rows.map(row => {
      const rowId = row[IDS[table] || 'id'];
      if (rowId == null) throw new ContextError('READ_FAILED', `Context source lacks id: ${table}`);
      const data = {};
      for (const field of FIELDS[table]) if (Object.hasOwn(row, field)) data[field] = bounded(row[field]);
      return { data, source: { schema: 'public', table, id: String(rowId) } };
    });
    return one ? (wrapped[0] || null) : wrapped;
  }

  async function person(id) {
    const result = await read('customers', { Id: id, deleted_at: null }, { one: true });
    if (!result) throw new ContextError('NOT_FOUND', 'Customer not found');
    return result;
  }

  async function personContext(id, interactionLimit, extended) {
    const p = await person(id);
    const [interactions, opportunities] = await Promise.all([
      read('followups', { customer_id: id, deleted_at: null }, { order: 'followup_date', limit: interactionLimit }),
      read('opportunities', { customer_id: id, deleted_at: null }, { order: 'updated_at', limit: LIMITS.opportunities }),
    ]);
    const context = { person: p, recent_interactions: interactions, open_opportunities: opportunities };
    if (extended) {
      const [products, reports] = await Promise.all([
        read('products', { customer_id: id, deleted_at: null }, { order: 'created_at', limit: LIMITS.products }),
        read('policy_review_reports', { customer_id: id, deleted_at: null }, { order: 'report_date', limit: LIMITS.reports }),
      ]);
      // The Skill Registry accepts meeting_history only; attach compact evidence there.
      context.meeting_history = [...reports, ...products];
    }
    return context;
  }

  async function buildContext({ recipe, subjectType, subjectId, options = {} } = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => key !== 'interactionLimit')) {
      throw new ContextError('INVALID_OPTIONS', 'Unsupported context options');
    }
    const interactionLimit = cap(options.interactionLimit, LIMITS.interactions, LIMITS.interactionsMax);
    let context;
    let subject;
    switch (recipe) {
      case 'person_basic':
      case 'meeting_prep':
        if (subjectType !== 'customer') throw new ContextError('INVALID_SUBJECT', 'Expected customer subject');
        subject = idOf(subjectId);
        context = await personContext(subject, interactionLimit, recipe === 'meeting_prep');
        break;
      case 'quick_capture':
        if (subjectType === 'none' && subjectId == null) {
          subject = null;
          context = {};
        } else throw new ContextError('INVALID_SUBJECT', 'Expected none subject');
        break;
      case 'today_coach': {
        if (subjectType !== 'day') throw new ContextError('INVALID_SUBJECT', 'Expected day subject');
        subject = dayOf(subjectId);
        const [followups, opportunities, customers] = await Promise.all([
          read('followups', { next_followup_date: subject, deleted_at: null }, { order: 'followup_date', limit: interactionLimit }),
          read('opportunities', { next_action_date: subject, deleted_at: null }, { order: 'updated_at', limit: LIMITS.opportunities }),
          read('customers', { next_action_date: subject, deleted_at: null }, { order: 'updated_at', limit: LIMITS.actions }),
        ]);
        context = { daily_snapshot: { day: subject, scope: 'due_on_day_only',
          source: { schema: 'public', tables: ['followups', 'opportunities', 'customers'], kind: 'derived_capped_counts' },
          returned: { interactions: followups.length, opportunities: opportunities.length, customers: customers.length },
          limits: { interactions: interactionLimit, opportunities: LIMITS.opportunities, customers: LIMITS.actions } },
          recent_interactions: followups, open_opportunities: opportunities, current_actions: customers };
        break;
      }
      case 'activity_review': {
        if (subjectType !== 'activity') throw new ContextError('INVALID_SUBJECT', 'Expected activity subject');
        subject = idOf(subjectId);
        const activity = await read('activities', { id: subject, deleted_at: null }, { one: true });
        if (!activity) throw new ContextError('NOT_FOUND', 'Activity not found');
        const [participants, tasks] = await Promise.all([
          read('activity_participants', { activity_id: subject, deleted_at: null }, { order: 'created_at', limit: LIMITS.participants }),
          read('activity_tasks', { activity_id: subject }, { order: 'created_at', limit: LIMITS.tasks }),
        ]);
        context = { activity, participants, tasks };
        break;
      }
      case 'recruit_coach': {
        if (subjectType !== 'candidate') throw new ContextError('INVALID_SUBJECT', 'Expected candidate subject');
        subject = idOf(subjectId);
        const candidate = await read('recruit_candidates', { id: subject, deleted_at: null }, { one: true });
        if (!candidate) throw new ContextError('NOT_FOUND', 'Candidate not found');
        const customerId = idOf(candidate.data.customer_id);
        const [customer, followups] = await Promise.all([
          person(customerId),
          read('recruit_followups', { candidate_id: subject, deleted_at: null }, { order: 'followup_date', limit: interactionLimit }),
        ]);
        context = { candidate, person: customer, recruit_followups: followups };
        break;
      }
      default: throw new ContextError('UNKNOWN_RECIPE', 'Unknown context recipe');
    }
    // Pass this context to runAITask: AI Gateway stores it in ai_tasks.context_snapshot.
    return { recipe, version: VERSION, subjectType, subjectId: subject, context,
      context_snapshot: { ...context, _context: { recipe, version: VERSION, subjectType, subjectId: subject,
        builtAt: now().toISOString(), interactionLimit } } };
  }

  return { buildContext };
}

module.exports = { createContextEngine, ContextError, VERSION, LIMITS };
