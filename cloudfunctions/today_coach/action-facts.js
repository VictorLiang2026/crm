'use strict';

const crypto = require('crypto');

const COLUMNS = 'id,person_id,opportunity_id,interaction_id,activity_id,action_type,title,description,due_at,priority,status,source,urgency_score,impact_score,confidence_score,effort_score,priority_score,updated_at';
const PERSON_COLUMNS = 'id,display_name,legacy_customer_id,deleted_at';

function clamp(value, fallback) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n)
    ? fallback : Math.max(0, Math.min(100, n));
}

function scoreDimensions(dimensions, canonical) {
  const d = dimensions;
  const score = Math.round(
    d.urgency * 0.27 + d.impact * 0.22 + d.confidence * 0.12 +
    (100 - d.effort) * 0.10 + d.relationship_value * 0.14 +
    d.opportunity_value * 0.15 + (canonical ? 8 : 0)
  );
  return Math.min(100, score);
}

function dueUrgency(days) {
  if (days === null) return 15;
  if (days < 0) return days >= -7 ? 100 : 90;
  if (days === 0) return 100;
  if (days <= 2) return 80;
  if (days <= 7) return 60;
  return 30;
}

function fingerprint(rows) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(`${row.id}:${row.updated_at || ''};`);
  return hash.digest('hex').slice(0, 20);
}

async function readOpenActions({ env, key, fetchImpl = fetch }) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Today Action access is not configured');
  async function get(table, params) {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    url.searchParams.set('select', params.select);
    for (const [name, value] of Object.entries(params.filters || {})) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(url, {
        method: 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Today Action database request failed (${response.status})`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected Today Action database response');
      return rows;
    } finally { clearTimeout(timer); }
  }
  const rows = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await get('actions', {
      select: COLUMNS,
      filters: { status: 'in.(open,in_progress)', order: 'id.asc', limit: '200', offset: String(offset) },
    });
    rows.push(...page);
    if (page.length < 200) break;
    if (offset === 800) throw new Error('Too many open Actions for Today ranking');
  }
  const ids = [...new Set(rows.map(row => Number(row.person_id)).filter(Number.isSafeInteger))];
  const persons = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    persons.push(...await get('persons', {
      select: PERSON_COLUMNS,
      filters: { id: `in.(${ids.slice(offset, offset + 100).join(',')})`, limit: '100' },
    }));
  }
  if (new Set(persons.map(p => Number(p.id))).size !== ids.length) {
    throw new Error('Today Action Person mapping incomplete');
  }
  return { rows, persons };
}

function mapActions(data, facts, today, dayKeyOf, diffDays) {
  const personMap = new Map(facts.persons.map(p => [Number(p.id), p]));
  const customerMap = new Map((data.customers || []).map(c => [Number(c.Id), c]));
  const followupMap = new Map();
  for (const f of data.followups || []) {
    const current = followupMap.get(Number(f.customer_id));
    if (!current || String(f.followup_date || '') > String(current.followup_date || '')) {
      followupMap.set(Number(f.customer_id), f);
    }
  }
  const opportunityMap = new Map((data.opportunities || []).map(o => [Number(o.id), o]));
  return facts.rows.flatMap(row => {
    const person = personMap.get(Number(row.person_id));
    if (!person || person.deleted_at) return [];
    const customer = person.legacy_customer_id ? customerMap.get(Number(person.legacy_customer_id)) : null;
    if (person.legacy_customer_id && !customer) return [];
    const actionDate = dayKeyOf(row.due_at) || '';
    const days = actionDate ? diffDays(actionDate, today) : null;
    const last = customer ? followupMap.get(Number(customer.Id)) : null;
    const lastDate = last ? dayKeyOf(last.followup_date) || '' : '';
    const age = lastDate ? -diffDays(lastDate, today) : null;
    const opportunity = row.opportunity_id ? opportunityMap.get(Number(row.opportunity_id)) : null;
    const dimensions = {
      urgency: clamp(row.urgency_score, dueUrgency(days)),
      impact: clamp(row.impact_score, ({ urgent: 90, high: 75, medium: 50, low: 25 })[row.priority] ?? 50),
      confidence: clamp(row.confidence_score, 50),
      effort: clamp(row.effort_score, 50),
      relationship_value: age === null ? 40 : age <= 14 ? 80 : age <= 45 ? 60 : 25,
      opportunity_value: opportunity ? 85 : row.opportunity_id ? 50 : 20,
    };
    const status = days === null ? 'unscheduled' : days < 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming';
    return [{
      action_id: `action-${row.id}`, action_type: row.action_type, person_type: 'person',
      person_id: Number(person.id), legacy_customer_id: person.legacy_customer_id || null,
      opportunity_id: row.opportunity_id || null, activity_id: row.activity_id || null,
      person_name: person.display_name, title: row.title, source: row.source,
      status, stage: customer?.customer_stage || '',
      prio_label: row.priority === 'urgent' || row.priority === 'high' ? '高' : row.priority === 'low' ? '低' : '中',
      action_date: actionDate, days_until: days, last_followup: lastDate,
      next_action: row.title, note: String(row.description || '').slice(0, 100),
      dimensions, score: scoreDimensions(dimensions, true), canonical: true,
      updated_at: row.updated_at,
    }];
  });
}

module.exports = { readOpenActions, mapActions, scoreDimensions, dueUrgency, fingerprint, clamp };
