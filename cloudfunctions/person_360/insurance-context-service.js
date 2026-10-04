/** Read-only insurance context for an authenticated Person 360 caller. */
'use strict';

const INSURANCE_TYPES = new Set([
  'insurance', '医疗保障', '重疾保障', '养老规划', '教育规划', '财富规划', '家庭保障',
]);
const CLOSED = new Set(['成交', '关闭']);
const CATEGORIES = {
  ap_ipa: '重疾(IPA)', ap_ppa: '个人养老金(PPA)', ap_ltc: '长期护理(LTC)',
  ap_ann: '年金(ANN)', ap_life: '终身寿险(LIFE)', ap_term: '定期寿险(TERM)',
  ap_wl: '万能险(WL)', ap_pa: '意外(PA)', ap_ci: '医疗(CI)',
  ap_hi: '健康(HI)', ap_all: '总保额(ALL)',
};
const INSURANCE_TEXT = /保险|保单|保障|保额|重疾|医疗|寿险|年金|意外|养老|保费/i;
const NEED_TEXT = /希望|需要|想要|想了解|关注|比较|询问|咨询/;

function idOf(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
}

function clip(value, length = 300) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

function parseArray(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function coverageFrom(row) {
  const items = parseArray(row.items);
  const byKey = new Map(items.filter(item => item && typeof item === 'object')
    .map(item => [item.key, item]));
  return Object.entries(CATEGORIES).flatMap(([key, label]) => {
    const item = byKey.get(key) || {};
    const amount = item.amount !== '' && item.amount != null ? item.amount : row[key];
    const premium = item.premium;
    if ((amount == null || amount === '') && (premium == null || premium === '')) return [];
    return [{ label, amount: amount ?? null, premium: premium ?? null,
      observedAt: item.update_date || row.created_at || null,
      provenance: '手工录入的保障明细，保单真实性待核实',
      source: { type: 'products', id: row.id } }];
  });
}

class InsuranceContextService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
  }

  async build(person) {
    const personId = idOf(person?.id);
    const customerId = person.legacy_customer_id == null ? null : idOf(person.legacy_customer_id);
    const read = (table, filters) => this.request(table, 'GET', filters);
    const [products, reports, ocr, photos, ownOpportunities, legacyOpportunities,
      actions, links, interactions, facts] = await Promise.all([
      customerId ? read('products', { select: 'id,items,created_at,' + Object.keys(CATEGORIES).join(','),
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'id.desc', limit: 3 }) : [],
      customerId ? read('policy_review_reports', {
        select: 'id,report_date,report_type,summary,edited_summary,gaps_found,edited_gaps,edited_recommendations,next_action,edited_next_action,updated_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'report_date.desc,id.desc', limit: 3,
      }) : [],
      customerId ? read('ocr_records', { select: 'id,summary,file_ids,file_names,created_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'created_at.desc,id.desc', limit: 10 }) : [],
      customerId ? read('photos', { select: 'id,file_name,photo_notes,category,created_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'created_at.desc,id.desc', limit: 20 }) : [],
      read('opportunities', { select: 'id,opportunity_type,status,last_progress,next_action,next_action_date,updated_at',
        person_id: `eq.${personId}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 100 }),
      customerId ? read('opportunities', { select: 'id,opportunity_type,status,last_progress,next_action,next_action_date,updated_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 100 }) : [],
      read('actions', { select: 'id,opportunity_id,title,due_at,priority,status',
        person_id: `eq.${personId}`, status: 'in.(open,in_progress)', order: 'due_at.asc.nullslast,id.desc', limit: 50 }),
      read('crm_opportunity_action_links', { select: 'action_id,opportunity_id',
        person_id: `eq.${personId}`, order: 'created_at.desc', limit: 100 }),
      read('interactions', { select: 'id,summary,interaction_at',
        person_id: `eq.${personId}`, order: 'interaction_at.desc,id.desc', limit: 30 }),
      read('context_items', { select: 'id,item_type,content,confirmed,created_at,last_verified_at',
        person_id: `eq.${personId}`, confirmed: 'eq.true', item_type: 'eq.fact',
        order: 'created_at.desc,id.desc', limit: 30 }),
    ]);
    const opportunityById = new Map();
    for (const row of ownOpportunities.concat(legacyOpportunities)) {
      if (INSURANCE_TYPES.has(row.opportunity_type) && !CLOSED.has(row.status)) {
        opportunityById.set(String(row.id), row);
      }
    }
    const opportunities = [...opportunityById.values()]
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 20);
    const opportunityIds = new Set(opportunities.map(row => String(row.id)));
    const linkedOpportunityByAction = new Map(links.filter(row =>
      opportunityIds.has(String(row.opportunity_id))).map(row =>
      [String(row.action_id), String(row.opportunity_id)]));
    const linkedActions = actions.filter(row => opportunityIds.has(String(row.opportunity_id)) ||
      linkedOpportunityByAction.has(String(row.id)));
    const actionOpportunityIds = new Set(linkedActions.map(row =>
      String(row.opportunity_id || linkedOpportunityByAction.get(String(row.id)))));
    const nextActions = linkedActions.map(row => ({ title: clip(row.title, 200), dueAt: row.due_at,
      provenance: '已确认行动', source: { type: 'actions', id: row.id } }));
    for (const row of opportunities) {
      if (row.next_action && !actionOpportunityIds.has(String(row.id))) {
        nextActions.push({ title: clip(row.next_action, 200), dueAt: row.next_action_date,
          provenance: '机会记录中的下一步，尚未成为行动',
          source: { type: 'opportunities', id: row.id } });
      }
    }
    const latestReport = reports[0] || null;
    const knownNeeds = facts.filter(row => INSURANCE_TEXT.test(row.content || ''))
      .map(row => ({ content: clip(row.content, 500), observedAt: row.last_verified_at || row.created_at,
        source: { type: 'context_items', id: row.id }, provenance: '已确认的事实记录；需求仍以原文为准' }));
    for (const row of interactions) {
      if (INSURANCE_TEXT.test(row.summary || '') && NEED_TEXT.test(row.summary || '')) {
        knownNeeds.push({ content: clip(row.summary, 500), observedAt: row.interaction_at,
          source: { type: 'interactions', id: row.id },
          provenance: '沟通记录提及的需求；不是已核实的保障事实' });
      }
    }
    const insuranceOcr = ocr.filter(row => INSURANCE_TEXT.test(`${row.summary || ''} ${row.file_names || ''}`)).slice(0, 5);
    const linkedPhotoIds = new Set(insuranceOcr.flatMap(row => parseArray(row.file_ids).map(String)));
    const evidence = photos.filter(row => linkedPhotoIds.has(String(row.id)) ||
      INSURANCE_TEXT.test(`${row.file_name || ''} ${row.photo_notes || ''}`)).slice(0, 8)
      .map(row => ({ id: row.id, fileName: clip(row.file_name, 120),
        note: clip(row.photo_notes, 160), category: row.category, createdAt: row.created_at,
        source: { type: 'photos', id: row.id }, provenance: '附件元数据，内容待人工核实' }));
    const existingCoverage = products.flatMap(coverageFrom);
    const hasEvidence = existingCoverage.length > 0 || insuranceOcr.length > 0 || evidence.length > 0;
    const potentialGaps = hasEvidence ? reports.flatMap(row => {
      const content = clip(row.edited_gaps, 500);
      return content ? [{ content, observedAt: row.updated_at || row.report_date,
        source: { type: 'policy_review_reports', id: row.id },
        provenance: '人工编辑的待核实问题；以原始保障资料复核' }] : [];
    }) : [];
    return {
      existingCoverage,
      review: { latest: latestReport ? { id: latestReport.id, date: latestReport.report_date,
        type: latestReport.report_type, summary: clip(latestReport.edited_summary || latestReport.summary, 500),
        source: { type: 'policy_review_reports', id: latestReport.id },
        provenance: latestReport.edited_summary ? '人工编辑，仍需核实' : 'AI 生成内容，尚未经人工复核' } : null,
      ocr: insuranceOcr.map(row => ({ id: row.id, summary: clip(row.summary, 200), createdAt: row.created_at,
        source: { type: 'ocr_records', id: row.id }, provenance: 'OCR 摘要，待人工核实' })), evidence },
      knownNeeds: knownNeeds.slice(0, 3), potentialGaps: potentialGaps.slice(0, 3),
      openOpportunities: opportunities.map(row => ({ id: row.id, type: row.opportunity_type,
        status: row.status, progress: clip(row.last_progress, 200), observedAt: row.updated_at,
        source: { type: 'opportunities', id: row.id } })),
      nextActions: nextActions.slice(0, 20),
      evidenceStatus: hasEvidence ? 'recorded' : 'unknown',
      legacyCustomerId: customerId,
    };
  }
}

module.exports = { InsuranceContextService };
