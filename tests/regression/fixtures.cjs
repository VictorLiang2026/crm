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
    status: mode === 'activity-ended' ? 'ended' : 'preparing',
    description: marker + '活动说明', topic_ids: [], deleted_at: null };
  const calls = [], violations = [], errors = [];
  let actionCommandStage = null;
  let loggedIn = params.get('login') !== 'required';
  window.__crmTest = { calls, violations, errors, loginAttempts: 0 };
  addEventListener('error', e => errors.push(e.message));
  addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  addEventListener('securitypolicyviolation', e => violations.push('CSP: ' + e.blockedURI));
  const fail = message => { violations.push(message); throw new Error(message); };
  const rows = value => ({ rows: mode === 'empty' ? [] : value, total: mode === 'empty' ? 0 : value.length, page: 1, pageSize: 50 });
  const replies = {
    'assistant:command': data => {
      if (data.stage === 'plan' && data.command?.personId === 980002) {
        actionCommandStage = 'planned';
        return { ok: true, status: 'planned', commandId: '11111111-1111-4111-8111-111111111111' };
      }
      if (data.stage === 'preview' && actionCommandStage === 'planned') {
        actionCommandStage = 'previewed';
        return { ok: true, status: 'previewed', previewHash: 'a'.repeat(32),
          preview: { person: { id: 980002, displayName: marker + '家人乙' },
            after: { title: marker + '联系', action_type: 'followup', priority: 'medium',
              description: '', due_at: null } } };
      }
      if (data.stage === 'confirm' && actionCommandStage === 'previewed' && data.previewHash === 'a'.repeat(32)) {
        actionCommandStage = 'confirmed';
        return { ok: true, status: 'confirmed' };
      }
      if (data.stage === 'execute' && actionCommandStage === 'confirmed') {
        actionCommandStage = 'executed';
        return { ok: true, status: 'executed', actionId: 990777 };
      }
      return fail('ACTION_COMMAND_STAGE_BYPASS');
    },
    'ai_activity:postReviewV2': () => ({ activity_id: activity.id, activity_name: activity.name,
      task_id: 800001, result_id: 800002, requires_confirmation: true,
      business_data_written: false, discarded_unsupported_items: 0,
      review: { summary: marker + '关系复盘摘要',
        whoMattered: [{ text: marker + '客户甲值得关注', sourceRefs: ['public.persons#980001'] }],
        whatChanged: [], relationshipsImproved: [], signalsAppeared: [], opportunitiesAppeared: [],
        followUpPeople: [], actionCandidates: [{ personId: '980001', personName: marker + '客户甲',
          title: marker + '核实需求', reason: marker + '活动后联系', sourceRefs: ['public.interactions#990001'] }] } }),
    'customers:list': data => {
      const all = mode === 'pagination'
        ? Array.from({ length: 55 }, (_, i) => ({ ...customer, Id: 910001 + i, customer_name: marker + '客户' + String(i).padStart(2, '0') }))
        : [customer];
      const keyword = String(data.keyword || '').trim().toLowerCase();
      const exact = String(data.exactName || '').trim().toLowerCase();
      const matched = (mode === 'empty' ? [] : all).filter(c =>
        (!exact || c.customer_name.toLowerCase() === exact) &&
        (!keyword || [c.customer_name, c.phone, c.occupation].some(v => String(v || '').toLowerCase().includes(keyword))));
      const page = Math.max(1, Number(data.page) || 1);
      const pageSize = Math.max(1, Number(data.pageSize) || 20);
      return { rows: matched.slice((page - 1) * pageSize, page * pageSize),
        total: matched.length, page, pageSize };
    },
    'customers:get': () => ({ customer, followups: mode === 'empty' ? [] : [followup], products: [], gifts: [], photos: [], recommendations: [], reports: [] }),
    'person_360:lookupCustomer': () => ({ personId: 980001 }),
    'assistant:opportunityCandidate': data => {
      if (data.operation === 'list') return { ok:true,status:'listed',rows:mode==='candidate' ? [{
        id:880001,person_id:980001,status:'draft',evidence:['public.interactions#990001'],
        draft:{opportunity_type:'insurance',reason:marker+'客户主动询问保障',
          next_action:marker+'先核实已有保障'},
      }] : [] };
      if (data.operation === 'context') return { ok:true,status:'context',evidence:mode==='candidate' ? [{
        ref:'public.interactions#990001',text:marker+'主动询问保障',
        certainty:'recorded_interaction',primary:true,
      }] : [] };
      if (data.operation === 'preview' && mode === 'candidate') return {ok:true,status:'previewed',
        previewHash:'a'.repeat(32),expiresAt:'2026-10-01T12:00:00Z',preview:{
          person:{id:980001,displayName:marker+'客户甲'},
          after:{opportunity_type:'insurance',reason:marker+'客户主动询问保障',
            next_action:marker+'先核实已有保障'},
        }};
      return fail('UNEXPECTED_OR_WRITE_ACTION: assistant:opportunityCandidate:' + data.operation);
    },
    'person_360:listDueCommitments': () => ({ overdue: [{ id: 991001, person_id: 980001,
      person_name: marker + '客户甲', commitment_type: 'I_PROMISED', content: marker + '已逾期承诺',
      due_at: '2026-09-20T01:00:00Z' }], dueSoon: [{ id: 991002, person_id: 980001,
      person_name: marker + '客户甲', commitment_type: 'MUTUAL', content: marker + '即将到期承诺',
      due_at: '2026-09-28T01:00:00Z' }], hasMoreOverdue: false, hasMoreDueSoon: false }),
    'person_360:get': () => ({ person: { id: 980001, display_name: marker + '客户甲', legacy_customer_id: customer.Id },
      household: mode === 'family' ? { id: 981001, important_facts: marker + '周末一起探望父母' } : null,
      members: mode === 'family' ? [{ id: 982001, person_id: 980002, relationship_to_anchor: 'spouse',
        person: { id: 980002, display_name: marker + '家人乙' } }] : [] }),
    'person_360:getRelationshipDecay': () => mode === 'empty' ? ({
      status: 'insufficient_evidence', why: '缺少明确的关系强度、最近一次重要互动，暂不能判断关系是否衰减。',
      confidence: 0, recommended_action: '先核实并补录真实的关系和互动信息，不要仅因经过的天数打扰对方。',
      candidate: false, persisted: false,
    }) : ({ status: 'signal', why: '最近一次重要互动距今 30 天；个人典型间隔约 7 天。',
      confidence: 0.65, recommended_action: '先核实是否有未录入的重要互动，再由人决定是否联系。',
      candidate: true, persisted: false,
      evidence: { importance_source: 'sales_priority_proxy' } }),
    'person_360:listOpportunities': () => rows(mode === 'empty' ? [] : [
      { id: 961001, person_id: 980001, customer_id: null, opportunity_type: 'recruit',
        status: '发现', next_action: marker + '联系候选人', updated_at: '2026-09-28' },
      { id: 960001, person_id: 980001, customer_id: customer.Id, opportunity_type: '家庭保障',
        status: '沟通', next_action: marker + '核对保障', updated_at: '2026-09-27' },
    ]),
    'person_360:listRecruitContext': () => rows(mode === 'empty' ? [] : [{
      id: candidate.candidate_id, stage: '面谈', motivation: marker + '了解事业',
      concerns: marker + '担心时间', potentialScore: 4, careerPlan: marker + '职业转型',
      nextAction: marker + '继续交流', nextActionDate: '2026-10-01',
      recentFollowups: [{ id: 950001, date: '2026-09-20', channel: '微信', summary: marker + '增员沟通' }],
    }]),
    'person_360:getInsuranceContext': () => ({
      existingCoverage: [{ label: '医疗(CI)', amount: 100000, premium: 3000 }],
      review: { latest: { date: '2026-09-20', summary: marker + '人工检视', provenance: '人工编辑' },
        ocr: [{ summary: marker + '保单摘要', provenance: 'OCR 摘要，待人工核实' }],
        evidence: [{ fileName: marker + '保险附件.pdf' }] },
      knownNeeds: [{ content: marker + '已记录需求', provenance: '人工编辑的检视内容，仍需与客户核实' }],
      potentialGaps: [{ content: marker + '待核实缺口', provenance: '报告生成内容，待人工核实' }],
      openOpportunities: [{ id: 960001, type: '家庭保障', status: '沟通' }],
      nextActions: [{ title: marker + '核对保障', dueAt: '2026-09-30' }],
      legacyCustomerId: customer.Id,
    }),
    'person_360:createOpportunity': () => ({ id: 961002 }),
    'person_360:updateOpportunity': () => ({ ok: true }),
    'person_360:search': () => ({ candidates: [{ id: 980002, display_name: marker + '家人乙' }], hasMore: false }),
    'person_360:resolveQuickCaptureName': () => ({ status: 'confirm_existing', hasMore: false,
      candidates: [{ id: '980001', displayName: marker + '客户甲', organization: '测试机构' }], selectedPersonId: null }),
    'person_360:addCanonicalParticipant': () => ({ id: 970002, linked: true, canonicalPersonId: '980001' }),
    'person_360:recordActivityInteraction': () => ({ interaction: { id: 990002 }, personId: '980001' }),
    'person_360:createSpeakerProfile': () => ({ id: 990011, personId: '980001', customerId: 910001 }),
    'person_360:linkSpeakerPerson': () => ({ ok: true, personId: '980001' }),
    'person_360:commitQuickCaptureV2': () => ({ interactionId: 990001, contextItemCount: 2 }),
    'ai_parse:quick_capture': data => data.version === 2 ? ({ today: '2026-09-27', preview: {
      personName: marker + '客户甲', interaction: { type: '微信', date: '2026-09-27', channel: '微信', summary: marker + '沟通摘要' },
      facts: [marker + '明确事实'], signals: [marker + '观察线索'],
      opportunityCandidates: [marker + '机会推断'], actionCandidates: [marker + '下一步建议'],
      commitmentCandidates: [marker + '明确约定'], evidence: [marker + '原话依据'],
    } }) : fail('UNEXPECTED_LEGACY_AI_PARSE'),
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
    'activity_speakers:list': () => rows([{ id: 990010, name: customer.customer_name,
      customer_id: customer.Id, person_id: null, expertise: marker + '讲师',
      relationship_stage: 'new', status: 'active' }]),
    'activity_tasks:list': () => rows([]),
    'activity_topics:list': () => rows([]),
    'today_coach:candidates': () => ({ fingerprint: 'test-only' }),
    'today_coach:daily_review': data => data.view === 'morning' ? ({
      view: 'morning', generated_at: '2026-10-01T00:00:00Z',
      sections: {
        morningBrief: { headline: marker + '晨间摘要', guidance: '先核对事实。', guidanceSource: 'rule' },
        topActions: [{ title: marker + '今日行动', personName: customer.customer_name,
          whyNow: '今天到期', target: '#/customer/910001' }],
        commitments: { overdue: [{ personName: customer.customer_name,
          content: marker + '已逾期承诺', dueAt: '2026-09-20', target: '#/person/980001' }], dueSoon: [] },
        upcoming: [{ title: marker + '近期活动', date: '2026-10-02', kind: 'activity', target: '#/activity/940001' }],
        risk: [{ title: marker + '逾期风险', target: '#/person/980001' }],
        opportunities: [{ personName: customer.customer_name, type: 'insurance', status: '沟通',
          target: '#/person/980001' }],
        needConfirmation: [{ personName: customer.customer_name, type: 'insurance',
          reason: marker + '待审核依据', target: '#/person/980001' }],
      },
    }) : !data.view && ['today', '7d'].includes(data.period) ? ({
      period: data.period, generated_at: '2026-10-01T00:00:00Z',
      start: '2026-10-01', end: '2026-10-01',
      review: { overview: marker + '旧版经营复盘', best_done: '已记录行动',
        biggest_gap: '需核对', key_customers: '', key_recruits: '',
        tomorrow_top3: ['核对资料'], advice: '保持人工判断' },
    }) : fail('UNEXPECTED_REVIEW_VIEW'),
    // Local fixture only: never invoke the real generate action (AI cost / side effects).
    'today_coach:generate': () => ({ source: 'rules', fingerprint: 'test-only', generated_at: '2026-09-21T00:00:00Z',
      today5: mode === 'empty' ? [] : [{ person_type: 'customer', person_id: customer.Id, person_name: customer.customer_name, action: marker + '今日行动', tier: 'must_do' },
        { person_type: 'person', person_id: 980001, person_name: customer.customer_name,
          action: marker + 'Action事项', what_to_do: marker + 'Action事项', why_now: '今天到期',
          expected_objective: '完成已记录行动并确认下一步', preparation: '核对已有记录', risk: '先核实信息',
          action_date: '2026-09-21', status: 'today', tier: 'recommended' }],
      items: mode === 'empty' ? [] : [{ type: 'customer', id: customer.Id, name: customer.customer_name,
        stage: '关系维护', priority: '高', assessment: marker + '今日依据', next_action: marker + '今日行动' },
        { type: 'person', id: 980001, name: customer.customer_name, priority: '高', assessment: '今天到期',
          next_action: marker + 'Action事项', expected_objective: '完成已记录行动并确认下一步',
          preparation: '核对已有记录', risk: '先核实信息' }], summary: marker + '今日摘要' }),
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
      calls.push({ name, action: data.action, operation: data.operation, stage: data.stage, id: data.id,
        customer_id: data.customer_id, candidate_id: data.candidate_id,
        page: data.page, pageSize: data.pageSize, keyword: data.keyword, exactName: data.exactName,
        sortField: data.sortField, sortDir: data.sortDir,
        candidateId:data.candidateId, personId: data.personId, version: data.version,
        payload: ['person_360:commitQuickCaptureV2', 'person_360:addCanonicalParticipant', 'person_360:recordActivityInteraction', 'person_360:createOpportunity',
          'person_360:updateOpportunity', 'person_360:createSpeakerProfile',
          'person_360:linkSpeakerPerson'].includes(key) ? data.data : null });
      if (!loggedIn) return fail('CALL_BEFORE_LOGIN: ' + key);
      if (mode === 'error' && (!params.get('fail') || params.get('fail') === key)) return { result: { error: 'TEST_API_FAILURE' } };
      return { result: structuredClone(replies[key](data)) };
    },
    rdb() { return fail('DIRECT_DATABASE_ACCESS'); },
    storage() { return fail('STORAGE_ACCESS'); }
  }; } };
  // Prevent accidental dialogs from confirming destructive actions.
  window.confirm = () => false;
  window.alert = message => errors.push('ALERT: ' + message);
}

module.exports = { installFixtures };
