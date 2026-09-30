/** Server-only, public-schema adapter: AI audit writes and one fixed read-only RPC. */
'use strict';

const AUDIT_TABLES = new Set(['ai_tasks', 'ai_runs', 'ai_results']);

function createSearchData({ env, key, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || typeof key !== 'string' || !key) {
    throw new Error('CRM search database is not configured');
  }

  async function request(path, method, filters, body) {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public',
          'Content-Profile': 'public', Accept: 'application/json',
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CRM search database request failed (${response.status})`);
      const payload = await response.text();
      return payload ? JSON.parse(payload) : null;
    } finally { clearTimeout(timer); }
  }

  const auditRdb = { from(table) {
    if (!AUDIT_TABLES.has(table)) throw new Error('Invalid AI audit table');
    const state = { method: null, body: null, id: null, selection: null };
    return {
      insert(row) { state.method = 'POST'; state.body = row; return this; },
      update(row) { state.method = 'PATCH'; state.body = row; return this; },
      eq(column, value) {
        if (column !== 'id' || !/^[1-9][0-9]*$/.test(String(value))) throw new Error('Invalid audit ID');
        state.id = String(value); return this;
      },
      select(columns) {
        if (columns !== 'id') throw new Error('Invalid audit selection');
        state.selection = columns; return this;
      },
      then(resolve, reject) {
        if (!state.method || state.selection !== 'id' ||
            (state.method === 'PATCH' && !state.id)) {
          return Promise.reject(new Error('Invalid audit operation')).then(resolve, reject);
        }
        return request(table, state.method,
          { select: 'id', ...(state.id ? { id: `eq.${state.id}` } : {}) }, state.body)
          .then(data => {
            if (!Array.isArray(data)) throw new Error('Invalid audit response');
            return { data };
          }).then(resolve, reject);
      },
    };
  } };

  async function search(template, months, limit) {
    if (!['activity_no_followup', 'child_education_no_insurance', 'declining_priority'].includes(template)
        || !Number.isInteger(months) || months < 1 || months > 12
        || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Invalid CRM search criteria');
    }
    const value = await request('rpc/crm_search_people_v1', 'POST', {},
      { p_template: template, p_months: months, p_limit: limit });
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Array.isArray(value.rows) || !Number.isInteger(value.total) ||
        !value.coverage || !Number.isInteger(value.coverage.rows)) {
      throw new Error('Invalid CRM search response');
    }
    return value;
  }

  return { auditRdb, search };
}

module.exports = { createSearchData };
