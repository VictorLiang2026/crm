/** Narrow, server-only public REST adapter for activity review context and AI audit. */
'use strict';

const READ_TABLES = new Set(['activities', 'activity_participants', 'activity_tasks',
  'activity_speakers', 'recruit_candidates', 'persons', 'interactions', 'actions',
  'opportunities', 'relationships']);
const AUDIT_TABLES = new Set(['ai_tasks', 'ai_runs', 'ai_results']);

function filterValue(value) {
  const text = String(value);
  if (!/^[\p{L}\p{N}_-]+$/u.test(text)) throw new Error('Invalid review filter');
  return text;
}

function createPublicRdb({ env, key, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || typeof key !== 'string' || !key) {
    throw new Error('Activity review database is not configured');
  }
  async function request(table, state) {
    if (!READ_TABLES.has(table) && !AUDIT_TABLES.has(table)) throw new Error('Invalid review table');
    if (state.method !== 'GET' && !AUDIT_TABLES.has(table)) throw new Error('Review business data is read-only');
    if (state.method === 'GET' && AUDIT_TABLES.has(table)) throw new Error('Review audit data is write-only');
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    if (state.select) url.searchParams.set('select', state.select);
    for (const [field, operation, value] of state.filters) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error('Invalid review field');
      url.searchParams.set(field, `${operation}.${value}`);
    }
    if (state.order) url.searchParams.set('order', state.order);
    if (state.limit != null) url.searchParams.set('limit', String(state.limit));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(url, {
        method: state.method,
        headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public',
          'Content-Profile': 'public', Accept: 'application/json',
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: state.body === undefined ? undefined : JSON.stringify(state.body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Activity review database request failed (${response.status})`);
      const payload = await response.text();
      const data = payload ? JSON.parse(payload) : [];
      if (!Array.isArray(data)) throw new Error('Unexpected activity review database response');
      return { data };
    } finally { clearTimeout(timer); }
  }
  return { from(table) {
    const state = { method: 'GET', filters: [], select: '', order: '', limit: null, body: undefined };
    const chain = {
      select(fields) {
        if (typeof fields !== 'string' || !/^[a-zA-Z0-9_,]+$/.test(fields)) throw new Error('Invalid review selection');
        state.select = fields; return this;
      },
      eq(field, value) { state.filters.push([field, 'eq', filterValue(value)]); return this; },
      is(field, value) {
        if (value !== null) throw new Error('Only null checks are supported');
        state.filters.push([field, 'is', 'null']); return this;
      },
      in(field, values) {
        if (!Array.isArray(values) || !values.length || values.length > 20) throw new Error('Invalid review ID set');
        state.filters.push([field, 'in', `(${values.map(filterValue).join(',')})`]); return this;
      },
      order(field, { ascending = false } = {}) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error('Invalid review order');
        state.order = `${field}.${ascending ? 'asc' : 'desc'}`; return this;
      },
      limit(value) {
        if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error('Invalid review limit');
        state.limit = value; return this;
      },
      insert(row) { state.method = 'POST'; state.body = row; return this; },
      update(row) { state.method = 'PATCH'; state.body = row; return this; },
      then(resolve, reject) { return request(table, state).then(resolve, reject); },
    };
    return chain;
  } };
}

module.exports = { createPublicRdb };
