'use strict';

// Entirely synthetic. These IDs must never be used against a live service.
function installFixtures() {
  const marker = '[CRM_TEST_ONLY]';
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'normal';
  const customer = { Id: 910001, customer_name: marker + '客户甲', phone: 'TEST-0001',
    customer_stage: '关系维护', sales_priority: 'A', deleted_at: null };
  const followup = { Id: 920001, customer_id: customer.Id, customer_name: customer.customer_name,
    followup_notes: marker + '跟进内容', followup_date: '2026-09-20',
    next_followup_date: '2026-09-25', next_action: marker + '预约沟通', deleted_at: null };
  const candidate = { candidate_id: 930001, customer_id: customer.Id,
    customer_name: marker + '候选人甲', stage: '新增人才', phone: 'TEST-0002', idle_days: 1 };
  const activity = { id: 940001, name: marker + '活动甲', activity_date: '2026-09-25',
    status: 'preparing', description: marker + '活动说明', topic_ids: [], deleted_at: null };
  const calls = [], violations = [], errors = [];
  let loggedIn = params.get('login') !== 'required';
  window.__crmTest = { calls, violations, errors, loginAttempts: 0 };
  addEventListener('error', e => errors.push(e.message));
  addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  addEventListener('securitypolicyviolation', e => violations.push('CSP: ' + e.blockedURI));
  const fail = message => { violations.push(message); throw new Error(message); };
  const rows = value => ({ rows: mode === 'empty' ? [] : value, total: mode === 'empty' ? 0 : value.length, page: 1, pageSize: 50 });
  const replies = {
    'customers:list': () => rows(mode === 'pagination'
      ? Array.from({ length: 55 }, (_, i) => ({ ...customer, Id: 910001 + i, customer_name: marker + '客户' + String(i).padStart(2, '0') }))
      : [customer]),
    'customers:get': () => ({ customer, followups: mode === 'empty' ? [] : [followup], products: [], gifts: [], photos: [], recommendations: [], reports: [] }),
    'customers:trashList': () => ({ ...rows([{ ...customer, Id: 910099, customer_name: marker + '已删除客户', deleted_at: '2026-09-20T01:00:00Z' }]), counts: {} }),
    'recruit_candidates:rcMap': () => rows([{ id: candidate.candidate_id, customer_id: customer.Id, deleted_at: null }]),
    'recruit_candidates:list': () => rows([candidate]),
    'recruit_candidates:funnel': () => ({ funnel: { '新增人才': mode === 'empty' ? 0 : 1 }, total: mode === 'empty' ? 0 : 1 }),
    'recruit_candidates:get': () => ({ candidate, milestones: [] }),
    'recruit_candidates:trashList': () => ({ ...rows([{ ...candidate, candidate_id: 930099, customer_name: marker + '已删除候选人', candidate_deleted_at: '2026-09-20T01:00:00Z', customer_deleted_at: null }]), counts: {} }),
    'recruit_followups:list': () => rows([{ id: 950001, candidate_id: candidate.candidate_id, followup_date: '2026-09-20', followup_notes: marker + '增员跟进' }]),
    'followups:list': () => rows([followup]),
    'opportunities:list': () => rows([{ id: 960001, customer_id: customer.Id, opportunity_type: '家庭保障', status: '沟通', notes: marker + '机会说明' }]),
    'activities:list': () => rows([activity]),
    'activities:get': () => ({ activity, participants: [{ id: 970001, person_type: 'customer', person_id: customer.Id, person_name: customer.customer_name, status: 'invited' }] }),
    'activity_tasks:list': () => rows([]),
    'activity_topics:list': () => rows([]),
    'today_coach:candidates': () => ({ fingerprint: 'test-only' }),
    // Local fixture only: never invoke the real generate action (AI cost / side effects).
    'today_coach:generate': () => ({ source: 'rules', fingerprint: 'test-only', generated_at: '2026-09-21T00:00:00Z',
      today5: mode === 'empty' ? [] : [{ person_type: 'customer', person_id: customer.Id, person_name: customer.customer_name, action: marker + '今日行动', tier: 'must_do' }],
      items: mode === 'empty' ? [] : [{ type: 'customer', id: customer.Id, name: customer.customer_name,
        stage: '关系维护', priority: '高', assessment: marker + '今日依据', next_action: marker + '今日行动' }], summary: marker + '今日摘要' }),
    'today_coach:cockpit': () => ({ trends: [], reminders: [] }),
    'funnel_insight:stats': () => ({ ok: true, generated_at: '2026-09-21T00:00:00Z', funnels: ['customer', 'opportunity', 'recruit'].map(key => ({
      key, label: marker + key, total: mode === 'empty' ? 0 : 1, metrics: [], rates: [], warnings: [],
      stages: [{ stage: marker + '阶段', count: 1, entered_30d: 1, moved_30d: null, overdue: 0, dwell_median_days: null, stuck: 0 }]
    })) })
  };
  window.cloudbase = { init() { return {
    auth() { return {
      hasLoginState: () => loggedIn,
      async signOut() { loggedIn = false; },
      async signInWithPassword(credentials) {
        window.__crmTest.loginAttempts++;
        if (credentials.username !== marker || credentials.password !== 'local-fixture-only') throw new Error('TEST_LOGIN_DENIED');
        loggedIn = true;
      }
    }; },
    async callFunction({ name, data }) {
      const key = name + ':' + data.action;
      if (!Object.hasOwn(replies, key)) return fail('UNEXPECTED_OR_WRITE_ACTION: ' + key);
      calls.push({ name, action: data.action, id: data.id, customer_id: data.customer_id, candidate_id: data.candidate_id });
      if (!loggedIn) return fail('CALL_BEFORE_LOGIN: ' + key);
      if (mode === 'error' && (!params.get('fail') || params.get('fail') === key)) return { result: { error: 'TEST_API_FAILURE' } };
      return { result: structuredClone(replies[key]()) };
    },
    rdb() { return fail('DIRECT_DATABASE_ACCESS'); },
    storage() { return fail('STORAGE_ACCESS'); }
  }; } };
  // Prevent accidental dialogs from confirming destructive actions.
  window.confirm = () => false;
  window.alert = message => errors.push('ALERT: ' + message);
}

module.exports = { installFixtures };
