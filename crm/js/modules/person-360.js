// Isolated Person 360 view. All data requests use the existing authenticated callFn bridge.
import { renderOpportunityCandidates } from './opportunity-candidates.js';
const ROLE_LABELS = { spouse: '配偶', child: '子女', parent: '父母', sibling: '兄弟姐妹', other: '其他' };
const OPPORTUNITY_LABELS = {
  insurance: '保险', recruit: '增员', referral: '转介绍', activity: '活动',
  speaker: '嘉宾', partnership: '合作', service: '服务', relationship: '关系',
};
const OPPORTUNITY_STATUSES = ['发现', '沟通', '方案', '成交', '关闭'];
const REFERRAL_STATUSES = ['潜在线索', '已介绍', '已联系', '已建立关系', '成交', '关闭'];

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}

function button(label, onClick, className = '') {
  const element = node('button', `btn ${className}`, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

export async function renderPerson360({ root, personId, callFn }) {
  const hash = `#/person/${personId}`;
  root.replaceChildren(node('div', 'loading', '正在加载 Person 360…'));
  const request = async (action, data = {}) => {
    const result = await callFn('person_360', { action, ...data });
    if (!result || result.error) throw new Error(result?.error || '请求失败');
    return result;
  };
  let model;
  try { model = await request('get', { personId }); }
  catch (error) {
    if (location.hash === hash) root.replaceChildren(node('div', 'empty', `Person 360 加载失败：${error.message}`));
    return;
  }
  if (location.hash !== hash) return;

  const wrap = node('div', 'person360');
  const top = node('div', 'person360-toolbar');
  const back = node('a', '', '← 返回客户详情');
  back.href = model.person.legacy_customer_id ? `#/customer/${model.person.legacy_customer_id}` : '#/customers';
  top.append(back);
  wrap.append(top, node('h2', '', `${model.person.display_name} · Person 360`));

  const decay = node('section', 'card person360-card person360-decay');
  decay.append(node('h3', '', '关系节奏提醒'));
  const decayBody = node('div', 'person360-decay-body');
  decayBody.append(node('p', 'person360-muted', '正在核对关系与互动依据…'));
  decay.append(decayBody);
  wrap.append(decay);
  void request('getRelationshipDecay', { personId }).then(result => {
    if (location.hash !== hash) return;
    if (!['signal', 'stable', 'insufficient_evidence'].includes(result.status) ||
        typeof result.why !== 'string' || typeof result.recommended_action !== 'string') {
      throw new Error('关系提示数据格式异常');
    }
    const status = {
      signal: '建议关注（待人工核实）', stable: '当前节奏未见明显偏离',
      insufficient_evidence: '证据不足，暂不判断',
    }[result.status];
    decayBody.replaceChildren(node('strong', '', status),
      node('p', '', `依据：${result.why}`),
      node('p', '', `建议行动：${result.recommended_action}`));
    if (result.status === 'insufficient_evidence') {
      decayBody.append(node('p', 'person360-muted', '置信度：无法评估（证据不足）。'));
    } else if (Number.isFinite(result.confidence)) {
      decayBody.append(node('p', 'person360-muted',
        `置信度：${Math.round(result.confidence * 100)}% · 仅供人工判断，不会自动创建行动。`));
    }
    if (result.evidence?.importance_source === 'sales_priority_proxy') {
      decayBody.append(node('p', 'person360-muted',
        '关系重要性暂以客户优先级代用，并已降低置信度；这不是已确认的关系事实。'));
    }
  }).catch(error => {
    if (location.hash === hash) decayBody.replaceChildren(
      node('p', 'person360-error', `关系提示加载失败：${error.message}`));
  });

  const opportunities = node('section', 'card person360-card person360-opportunities');
  opportunities.append(node('h3', '', '经营机会'));
  const opportunityList = node('div', 'person360-opportunity-list');
  const formHost = node('div', 'person360-opportunity-form-host');
  opportunities.append(opportunityList);
  try {
    const result = await request('listOpportunities', { personId });
    if (location.hash !== hash) return;
    if (!Array.isArray(result.rows)) throw new Error('机会数据格式异常');
    if (!result.rows.length) opportunityList.append(node('p', 'person360-muted', '暂无经营机会。已删除的旧机会不会自动恢复。'));
    for (const opportunity of result.rows) {
      const row = node('div', 'person360-opportunity');
      const title = node('div');
      title.append(node('strong', '', OPPORTUNITY_LABELS[opportunity.opportunity_type] || opportunity.opportunity_type),
        node('span', 'person360-muted', ` · ${opportunity.status || '未分阶段'}`));
      if (opportunity.next_action) title.append(node('div', '', `下一步：${opportunity.next_action}`));
      if (opportunity.next_action_date) title.append(node('small', 'person360-muted', `日期：${opportunity.next_action_date}`));
      row.append(title);
      if (opportunity.customer_id != null) {
        const link = node('a', '', '到客户详情');
        link.href = `#/customer/${opportunity.customer_id}`;
        row.append(link);
      } else {
        row.append(button('编辑', () => showOpportunityForm(opportunity)));
      }
      opportunityList.append(row);
    }
    opportunities.append(button('新增 Person 机会', () => showOpportunityForm(null), 'btn-primary'));
  } catch (error) {
    opportunityList.append(node('p', 'person360-error', `机会加载失败：${error.message}`));
  }
  opportunities.append(formHost);
  wrap.append(opportunities);
  renderOpportunityCandidates({root:wrap,personId,callFn,
    onCreated:()=>{if(location.hash===hash)void renderPerson360({root,personId,callFn});}});

  function showOpportunityForm(opportunity) {
    formHost.replaceChildren();
    const form = node('form', 'person360-opportunity-form');
    form.append(node('h4', '', opportunity ? '编辑 Person 机会' : '新增 Person 机会'));
    const type = node('select');
    for (const [value, label] of Object.entries(OPPORTUNITY_LABELS)) {
      const option = node('option', '', label);
      option.value = value;
      type.append(option);
    }
    type.value = opportunity?.opportunity_type || 'insurance';
    const status = node('select');
    function refreshStatuses() {
      const previous = status.value;
      status.replaceChildren();
      for (const value of type.value === 'referral' ? REFERRAL_STATUSES : OPPORTUNITY_STATUSES) {
        const option = node('option', '', value);
        option.value = value;
        status.append(option);
      }
      status.value = [...status.options].some(option => option.value === previous) ? previous :
        type.value === 'referral' ? '潜在线索' : '发现';
    }
    refreshStatuses();
    status.value = opportunity?.status || status.value;
    type.addEventListener('change', refreshStatuses);
    const nextAction = node('input');
    nextAction.type = 'text'; nextAction.maxLength = 1000;
    nextAction.value = opportunity?.next_action || '';
    const nextDate = node('input');
    nextDate.type = 'date'; nextDate.value = opportunity?.next_action_date || '';
    const progress = node('textarea');
    progress.maxLength = 4000; progress.value = opportunity?.last_progress || '';
    const fields = [
      ['机会类型', type], ['阶段', status], ['下一步行动', nextAction],
      ['行动日期', nextDate], ['进展', progress],
    ];
    for (const [label, input] of fields) {
      const line = node('label', 'person360-opportunity-field');
      line.append(node('span', '', label), input);
      form.append(line);
    }
    const error = node('p', 'person360-error');
    form.append(error);
    const controls = node('div', 'person360-row');
    const save = node('button', 'btn btn-primary', '保存机会');
    save.type = 'submit';
    controls.append(save, button('取消', () => formHost.replaceChildren()));
    form.append(controls);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      error.textContent = '';
      try {
        const data = {
          opportunity_type: type.value, status: status.value,
          next_action: nextAction.value.trim(), next_action_date: nextDate.value || null,
          last_progress: progress.value.trim(),
        };
        await request(opportunity ? 'updateOpportunity' : 'createOpportunity',
          opportunity ? { personId, id: opportunity.id, data } : { personId, data });
        await renderPerson360({ root, personId, callFn });
      } catch (cause) {
        error.textContent = `保存失败：${cause.message}`;
        save.disabled = false;
      }
    });
    formHost.append(form);
  }

  const recruit = node('section', 'card person360-card person360-recruit');
  recruit.append(node('h3', '', '招募 · Recruit'));
  const recruitBody = node('div', 'person360-recruit-list');
  recruit.append(recruitBody);
  wrap.append(recruit);
  try {
    const result = await request('listRecruitContext', { personId });
    if (location.hash !== hash) return;
    if (!Array.isArray(result.rows)) throw new Error('招募数据格式异常');
    if (!result.rows.length) recruitBody.append(node('p', 'person360-muted', '暂无在用招募候选人。'));
    for (const candidate of result.rows) {
      const card = node('div', 'person360-recruit-candidate');
      const heading = node('div', 'person360-recruit-heading');
      heading.append(node('strong', '', `阶段：${candidate.stage || '未分阶段'}`));
      const link = node('a', '', '打开原招募详情');
      link.href = `#/recruit/${candidate.id}`;
      heading.append(link);
      card.append(heading);
      const fields = [
        ['动机', candidate.motivation], ['顾虑', candidate.concerns],
        ['潜力评分', candidate.potentialScore], ['职业规划', candidate.careerPlan],
        ['下一步', candidate.nextAction],
      ];
      for (const [label, value] of fields) {
        if (value !== null && value !== undefined && value !== '') {
          card.append(node('p', '', `${label}：${value}`));
        }
      }
      if (candidate.nextActionDate) card.append(node('p', 'person360-muted', `下一步日期：${String(candidate.nextActionDate).slice(0, 10)}`));
      const followups = Array.isArray(candidate.recentFollowups) ? candidate.recentFollowups : [];
      card.append(node('h4', '', '最近招募互动'));
      if (!followups.length) card.append(node('p', 'person360-muted', '暂无招募跟进。新增跟进后会在此和 Interaction 时间线即时呈现。'));
      for (const followup of followups) {
        card.append(node('p', 'person360-recruit-followup',
          `${String(followup.date || '').slice(0, 10)}${followup.channel ? ` · ${followup.channel}` : ''} · ${followup.summary || '增员跟进'}`));
      }
      recruitBody.append(card);
    }
  } catch (error) {
    recruitBody.append(node('p', 'person360-error', `招募资料加载失败：${error.message}`));
  }

  const insurance = node('section', 'card person360-card person360-insurance');
  insurance.append(node('h3', '', '保险概览'));
  const insuranceBody = node('div', 'person360-insurance-grid');
  insurance.append(insuranceBody);
  wrap.append(insurance);
  try {
    const context = await request('getInsuranceContext', { personId });
    if (location.hash !== hash) return;
    function section(title, rows, empty, render) {
      const block = node('div', 'person360-insurance-block');
      block.append(node('h4', '', title));
      if (!rows.length) block.append(node('p', 'person360-muted', empty));
      for (const row of rows) block.append(render(row));
      insuranceBody.append(block);
    }
    section('Existing Coverage · 已录入保障', context.existingCoverage || [],
      '尚无已录入保单明细；不能据此判断没有保障。', row =>
        node('p', '', `${row.label}：保额 ${row.amount ?? '—'}，年缴 ${row.premium ?? '—'}`));
    const reviewRows = [];
    if (context.review?.latest) reviewRows.push({ label: '最近检视',
      text: `${context.review.latest.date || ''} ${context.review.latest.summary || '暂无摘要'}`,
      provenance: context.review.latest.provenance });
    for (const row of context.review?.ocr || []) reviewRows.push({ label: 'OCR',
      text: row.summary, provenance: row.provenance });
    for (const row of context.review?.evidence || []) reviewRows.push({ label: '资料',
      text: `${row.fileName || '未命名文件'}${row.note ? ` · ${row.note}` : ''}`, provenance: '附件元数据' });
    section('Review · 检视与依据', reviewRows, '暂无相关检视报告、OCR 摘要或资料。', row =>
      node('p', '', `${row.label}：${row.text}（${row.provenance}）`));
    section('Known Needs · 已记录需求', context.knownNeeds || [],
      '暂无人工编辑的检视需求。', row => node('p', '', `${row.content}（${row.provenance}）`));
    section('Potential Gaps · 待核实缺口', context.potentialGaps || [],
      '暂无报告提出的待核实缺口；不能据此判断保障充分。', row =>
        node('p', '', `${row.content}（${row.provenance}）`));
    section('Open Opportunities · 进行中的保险机会', context.openOpportunities || [],
      '暂无进行中的保险机会。', row =>
        node('p', '', `${row.type} · ${row.status || '未分阶段'}${row.progress ? ` · ${row.progress}` : ''}`));
    section('Next Actions · 下一步行动', context.nextActions || [],
      '暂无已记录的保险相关行动。', row =>
        node('p', '', `${row.title}${row.dueAt ? ` · ${String(row.dueAt).slice(0, 10)}` : ''}`));
    if (context.legacyCustomerId) {
      const link = node('a', '', '打开原保单检视页面');
      link.href = `#/customer/${context.legacyCustomerId}`;
      insurance.append(link);
    }
  } catch (error) {
    insuranceBody.append(node('p', 'person360-error', `保险概览加载失败：${error.message}`));
  }

  const family = node('section', 'card person360-card');
  family.append(node('h3', '', '家庭成员'));
  if (!model.members.length) family.append(node('p', 'person360-muted', '尚未关联家庭成员。只可选择已有 Person，且需人工确认。'));
  for (const member of model.members) {
    const row = node('div', 'person360-member');
    const name = member.person?.display_name || '已删除的 Person';
    row.append(node('span', '', `${ROLE_LABELS[member.relationship_to_anchor] || '其他'} · ${name}`));
    row.append(button('移除', async () => {
      if (!window.confirm(`确认移除 ${name} 的家庭关联？Person 记录不会删除。`)) return;
      try {
        await request('removeMember', { personId, membershipId: member.id, confirmed: true });
        await renderPerson360({ root, personId, callFn });
      } catch (error) { window.alert(`移除失败：${error.message}`); }
    }, 'person360-remove'));
    family.append(row);
  }

  const add = node('div', 'person360-add');
  add.append(node('h4', '', '关联已有 Person'));
  const searchInput = node('input');
  searchInput.type = 'search';
  searchInput.placeholder = '输入完整姓名，例如 张玮（电信）';
  searchInput.maxLength = 160;
  const searchLine = node('div', 'person360-row');
  const candidateList = node('div', 'person360-candidates');
  let chosen = null;
  const searchButton = button('查找', async () => {
    chosen = null;
    candidateList.replaceChildren();
    try {
      const result = await request('search', { name: searchInput.value.trim() });
      if (!result.candidates.length) {
        candidateList.append(node('p', 'person360-muted', '没有匹配的现有 Person；此处不会自动新建。'));
        return;
      }
      for (const candidate of result.candidates) {
        const label = node('label', 'person360-candidate');
        const radio = node('input');
        radio.type = 'radio'; radio.name = 'person360-candidate';
        radio.addEventListener('change', () => { chosen = candidate; });
        label.append(radio, node('span', '', `${candidate.display_name} · #${candidate.id}${candidate.occupation ? ` · ${candidate.occupation}` : ''}`));
        candidateList.append(label);
      }
      if (result.hasMore) candidateList.append(node('p', 'person360-muted', '匹配人数较多，请补充括号限定后重新查找。'));
    } catch (error) { candidateList.append(node('p', 'person360-error', `查找失败：${error.message}`)); }
  });
  searchLine.append(searchInput, searchButton);
  add.append(searchLine, candidateList);
  const role = node('select');
  for (const [value, label] of Object.entries(ROLE_LABELS)) {
    const option = node('option', '', label);
    option.value = value;
    role.append(option);
  }
  const attachLine = node('div', 'person360-row');
  attachLine.append(role, button('确认关联', async () => {
    if (!chosen) { window.alert('请先查找并选择一位已有 Person。'); return; }
    if (!window.confirm(`确认把 ${chosen.display_name} 作为 ${ROLE_LABELS[role.value]} 关联到 ${model.person.display_name} 的家庭？`)) return;
    try {
      await request('addMember', {
        personId, memberId: chosen.id, relationship: role.value,
        selectedDisplayName: chosen.display_name, confirmed: true,
      });
      await renderPerson360({ root, personId, callFn });
    } catch (error) { window.alert(`关联失败：${error.message}`); }
  }, 'btn-primary'));
  add.append(attachLine);
  family.append(add);
  wrap.append(family);

  const facts = node('section', 'card person360-card');
  facts.append(node('h3', '', '重要家庭事实'));
  const textarea = node('textarea', 'person360-facts');
  textarea.value = model.household?.important_facts || '';
  textarea.maxLength = 2000;
  textarea.placeholder = '只记录有助于了解家庭关系的事实；不记录资产、收入或理财建议。';
  facts.append(textarea, node('p', 'person360-muted', '人工记录，最多 2000 字。'));
  facts.append(button('保存事实', async () => {
    try {
      await request('saveFacts', { personId, facts: textarea.value });
      await renderPerson360({ root, personId, callFn });
    } catch (error) { window.alert(`保存失败：${error.message}`); }
  }, 'btn-primary'));
  wrap.append(facts);
  root.replaceChildren(wrap);
}
