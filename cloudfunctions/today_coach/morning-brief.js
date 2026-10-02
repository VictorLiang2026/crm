'use strict';

// Bounded, service-only public reads. The browser never receives the database key.
const TABLES = new Set(['commitments', 'opportunities', 'opportunity_candidates', 'persons']);
const SELECT = {
  commitments: 'id,person_id,commitment_type,content,due_at,status',
  opportunities: 'id,person_id,customer_id,opportunity_type,status,next_action,updated_at',
  opportunity_candidates: 'id,person_id,draft,status,created_at',
  persons: 'id,display_name,legacy_customer_id,deleted_at',
};
const GUIDANCE = Object.freeze({
  overdue_commitment: '先核对逾期承诺的真实进展，再决定如何履约或沟通。',
  due_action: '优先处理有明确截止日期的行动，联系前核对已有记录。',
  opportunity_review: '先审核机会候选的证据，由人决定是否推进为正式机会。',
  prepare_activity: '提前核对近期活动安排和相关待办，再准备联系。',
  regular: '从有来源的行动和最近记录出发，确定今天的经营重点。',
});

function addDays(day, count) {
  return new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
}
function dayKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function short(value, max = 100) { return String(value || '').trim().slice(0, max); }
function targetFor(action) {
  const type = action.person_type;
  if (type === 'activity') return '#/activity/' + action.person_id;
  if (type === 'recruit') return '#/recruit/' + action.person_id;
  if (type === 'customer') return '#/customer/' + action.person_id;
  if (type === 'person') return '#/person/' + action.person_id;
  return '#/today';
}

async function readMorningFacts({ env, key, today, fetchImpl = fetch }) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) {
    throw new Error('Morning Brief access is not configured');
  }
  async function read(table, filters, limit) {
    if (!TABLES.has(table) || limit < 1 || limit > 100) throw new Error('Invalid Morning Brief read');
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    url.searchParams.set('select', SELECT[table]);
    for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, value);
    url.searchParams.set('limit', String(limit));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(url, {
        method: 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Morning Brief database request failed (${response.status})`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > limit) throw new Error('Invalid Morning Brief database response');
      return rows;
    } finally { clearTimeout(timer); }
  }
  const start = `${today}T00:00:00+08:00`;
  const end = `${addDays(today, 4)}T00:00:00+08:00`;
  const [overdue, dueSoon, opportunities, candidates] = await Promise.all([
    read('commitments', { status: 'eq.open', due_at: `lt.${start}`, order: 'due_at.asc,id.asc' }, 51),
    read('commitments', { status: 'eq.open', and: `(due_at.gte.${start},due_at.lt.${end})`, order: 'due_at.asc,id.asc' }, 51),
    read('opportunities', { deleted_at: 'is.null', status: 'not.in.(成交,关闭)', order: 'updated_at.desc,id.desc' }, 51),
    read('opportunity_candidates', { status: 'in.(draft,previewed,confirmed)', order: 'created_at.desc,id.desc' }, 21),
  ]);
  const ids = [...new Set([...overdue, ...dueSoon, ...opportunities, ...candidates]
    .map(row => Number(row.person_id)).filter(Number.isSafeInteger))];
  const persons = [];
  for (let i = 0; i < ids.length; i += 100) {
    persons.push(...await read('persons', { id: `in.(${ids.slice(i, i + 100).join(',')})` }, 100));
  }
  return {
    overdue: overdue.slice(0, 50), dueSoon: dueSoon.slice(0, 50),
    opportunities: opportunities.slice(0, 50), candidates: candidates.slice(0, 20), persons,
    hasMore: { overdue: overdue.length > 50, dueSoon: dueSoon.length > 50,
      opportunities: opportunities.length > 50, candidates: candidates.length > 20 },
  };
}

function buildMorningSections({ data, actions, facts, today }) {
  const persons = new Map((facts.persons || []).filter(p => !p.deleted_at).map(p => [Number(p.id), p]));
  const customers = new Map((data.customers || []).map(c => [Number(c.Id), c]));
  const nameOf = row => persons.get(Number(row.person_id))?.display_name ||
    customers.get(Number(row.customer_id))?.customer_name || '';
  const visible = row => row.person_id ? persons.has(Number(row.person_id)) :
    Boolean(row.customer_id && customers.has(Number(row.customer_id)));
  const commitment = row => ({ id: row.id, personId: row.person_id, personName: nameOf(row),
    type: row.commitment_type, content: short(row.content, 180), dueAt: row.due_at,
    target: '#/person/' + row.person_id, source: `public.commitments#${row.id}` });
  const overdue = (facts.overdue || []).filter(visible).map(commitment);
  const dueSoon = (facts.dueSoon || []).filter(visible).map(commitment);
  const topActions = (actions || []).slice(0, 5).map(a => ({
    id: a.action_id, title: short(a.title || a.next_action, 120), personName: short(a.person_name, 80),
    dueDate: a.action_date || null, status: a.status, score: a.score,
    whyNow: a.status === 'overdue' ? '已超过记录的截止日期' :
      a.status === 'today' ? '今天到期' : a.action_date ? '已记录截止日期' : '尚未记录截止日期',
    target: targetFor(a), source: a.canonical ? `public.actions#${String(a.action_id).replace(/^action-/, '')}` :
      `public.v_action_center#${a.action_id}`,
  }));
  const upcoming = [
    ...(data.activities || []).filter(a => {
      const day = dayKey(a.activity_date);
      return day >= today && day <= addDays(today, 7) &&
        !['cancelled', 'canceled', '已取消', 'ended', 'completed', '已结束'].includes(a.status);
    }).map(a => ({ title: short(a.name, 120), date: dayKey(a.activity_date),
      kind: 'activity', target: '#/activity/' + a.id, source: `public.activities#${a.id}` })),
    ...(actions || []).filter(a => a.action_date && a.action_date > today &&
      a.action_date <= addDays(today, 7)).slice(0, 20).map(a => ({
      title: short(a.title || a.next_action, 120), date: a.action_date,
      kind: 'action', target: targetFor(a), source: a.canonical ?
        `public.actions#${String(a.action_id).replace(/^action-/, '')}` : `public.v_action_center#${a.action_id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  const risk = [
    ...overdue.slice(0, 5).map(c => ({ title: `逾期承诺：${c.personName || '未命名人物'} · ${c.content}`,
      target: c.target, source: c.source })),
    ...(actions || []).filter(a => a.status === 'overdue').slice(0, 5).map(a => ({
      title: `逾期行动：${short(a.person_name, 60)} · ${short(a.title || a.next_action, 100)}`,
      target: targetFor(a), source: a.canonical ?
        `public.actions#${String(a.action_id).replace(/^action-/, '')}` : `public.v_action_center#${a.action_id}` })),
  ].slice(0, 10);
  const opportunities = (facts.opportunities || []).filter(visible).slice(0, 10).map(o => ({
    id: o.id, personName: nameOf(o), type: short(o.opportunity_type, 60),
    status: short(o.status, 30), nextAction: short(o.next_action, 140),
    target: o.person_id ? '#/person/' + o.person_id : '#/customer/' + o.customer_id,
    source: `public.opportunities#${o.id}`,
  }));
  const needConfirmation = (facts.candidates || []).filter(visible).slice(0, 10).map(c => ({
    id: c.id, personName: nameOf(c), type: short(c.draft?.opportunity_type, 60),
    reason: short(c.draft?.reason, 160), status: c.status,
    target: '#/person/' + c.person_id, source: `public.opportunity_candidates#${c.id}`,
  }));
  const counts = { topActions: topActions.length, overdueCommitments: overdue.length,
    dueSoonCommitments: dueSoon.length, upcoming: upcoming.length,
    risks: risk.length, opportunities: opportunities.length, needConfirmation: needConfirmation.length };
  const headline = overdue.length ? `记录中有 ${overdue.length} 项逾期承诺需要先核实。` :
    topActions.length ? `从已记录行动中选出 ${topActions.length} 项优先事项。` :
      '当前可用记录中暂未列出优先行动，请核对业务资料。';
  const focus = overdue.length ? 'overdue_commitment' :
    topActions.some(a => ['overdue', 'today'].includes(a.status)) ? 'due_action' :
      needConfirmation.length ? 'opportunity_review' : upcoming.length ? 'prepare_activity' : 'regular';
  return {
    morningBrief: { headline, counts, guidance: GUIDANCE[focus], guidanceSource: 'rule' },
    topActions, commitments: { overdue, dueSoon,
      hasMoreOverdue: Boolean(facts.hasMore?.overdue), hasMoreDueSoon: Boolean(facts.hasMore?.dueSoon) },
    upcoming, risk, opportunities, needConfirmation,
    limits: { opportunities: Boolean(facts.hasMore?.opportunities),
      needConfirmation: Boolean(facts.hasMore?.candidates) },
  };
}

async function enhanceGuidance(sections, generateText, extractJson) {
  const counts = sections.morningBrief.counts;
  if (!Object.values(counts).some(Boolean)) return sections;
  const messages = [
    { role: 'system', content: '你是 CRM 晨间简报助手。只选择工作重点，不补充客户事实，不输出姓名、数字、日期或具体模型。只返回 JSON：{"focus":"以下允许值之一"}。' },
    { role: 'user', content: JSON.stringify({ counts,
      allowed: Object.keys(GUIDANCE),
      instruction: '根据已记录数量选择一个最值得先处理的工作类别。逾期承诺优先。' }) },
  ];
  try {
    const { text } = await generateText(require('./test-data').withMessages(messages, sections.testData), { timeout: 10000 });
    const focus = extractJson(text)?.focus;
    if (typeof focus === 'string' && Object.hasOwn(GUIDANCE, focus) &&
        (counts.overdueCommitments === 0 || focus === 'overdue_commitment')) {
      sections.morningBrief.guidance = GUIDANCE[focus];
      sections.morningBrief.guidanceSource = 'ai';
    }
  } catch (_) { /* Read-only facts and deterministic advice remain available. */ }
  return sections;
}

module.exports = { readMorningFacts, buildMorningSections, enhanceGuidance };
