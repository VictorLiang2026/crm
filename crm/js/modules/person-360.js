import { renderTestDataNotice } from './test-data-notice.js';
import { renderPersonProfile } from './person-profile.js';
import { renderPersonInsights } from './person-insights.js';
import { mountPersonWorkItems } from './work-items.js';
import { mountOpportunityWorkflow } from './opportunity-workflow.js';
// Isolated Person 360 view. All data requests use the existing authenticated callFn bridge.
import { renderOpportunityCandidates } from './opportunity-candidates.js';
import { t } from './console/i18n.js';
const ROLE_LABELS = {
  spouse: t('family_relationship_spouse'), child: t('family_relationship_child'),
  parent: t('family_relationship_parent'), sibling: t('family_relationship_sibling'),
  other: t('family_relationship_other'),
};

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

export async function renderPerson360({ root, personId, callFn, openLegacyTab }) {
  const hash = `#/person/${personId}`;
  root.replaceChildren(node('div', 'loading', '正在加载 Person 360…'));
  const request = async (action, data = {}) => {
    const result = await callFn('person_360', { action, ...data });
    if (!result || result.error) throw new Error(result?.error || '请求失败');
    return result;
  };
  const reviewHousehold = async (operation, payload, summary) => {
    const idempotencyKey = window.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
      char => { const n = Math.random() * 16 | 0; return (char === 'x' ? n : (n & 3 | 8)).toString(16); });
    const preview = await request('previewHousehold', { personId, operation,
      data: { ...payload, idempotencyKey } });
    const before = preview.preview?.before || {};
    const after = preview.preview?.after || {};
    const detail = [summary, `\n${t('family_before')}: ${before.personName || before.facts || t('family_none')}`,
      `${t('family_after')}: ${after.memberName || after.facts || after.relationship || t('family_none')}`,
      `${t('family_preview_expiry')}: ${String(preview.expiresAt || '').replace('T', ' ').slice(0, 16)}`].join('\n');
    if (!window.confirm(`${t('family_review_note')}\n${detail}`)) return false;
    await request('executeHousehold', { previewId: preview.previewId });
    return true;
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
  const back = node('a', '', '← 返回人物');
  back.href = '#/people';
  top.append(back);
  if (model.customerId) {
    const legacy = node('a', '', '查看传统客户详情');
    legacy.href = `#/customer/${model.customerId}`;
    top.append(legacy);
  }
  top.append(button('编辑人物资料', () => openPersonEditor({ root, personId, callFn, openLegacyTab, model }), 'btn-sm'));
  wrap.append(top, node('h2', '', `${model.person.display_name} · Person 360`));
  const profile = node('section', 'card person360-card person360-profile');
  wrap.append(profile);
  void renderPersonProfile({ root: profile, personId, callFn, openLegacyTab,
    isCurrent: () => location.hash === hash });
  renderPersonInsights({ root: wrap, personId, customerId: model.customerId,
    callFn, openLegacyTab, isCurrent: () => location.hash === hash });
  const workItems = node('section', 'card person360-card person360-work-items');
  wrap.append(workItems);

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
    renderTestDataNotice(decayBody, result.testData);
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

  const opportunities = node('div', 'person360-opportunity-host');
  wrap.append(opportunities);
  mountOpportunityWorkflow({root:opportunities,personId,personName:model.person.display_name,callFn,
    isCurrent:()=>location.hash===hash});
  renderOpportunityCandidates({root:wrap,personId,callFn,
    onCreated:()=>{if(location.hash===hash)void renderPerson360({root,personId,callFn,openLegacyTab});}});
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
    renderTestDataNotice(insuranceBody, context.testData);
    insuranceBody.append(node('p', 'person360-muted',
      context.evidenceStatus === 'recorded' ?
        '以下仅汇总已录入资料；金额、报告与附件不等于已核实的真实保障。' :
        '保障资料未知：未见可核对的保单明细或附件，不能推断没有保障，也不能推断存在保障缺口。'));
    function sourceLine(row) {
      const line = node('div', 'person360-insurance-source');
      const source = row.source;
      const date = row.observedAt || row.date || row.createdAt || row.dueAt;
      line.append(node('span', '',
        `来源：${source?.type && source.id != null ? `public.${source.type}#${source.id}` : '待核验'} · 日期：${date ? String(date).slice(0, 10) : '未知'}`));
      if (row.provenance) line.append(node('span', '', ` · ${row.provenance}`));
      if (!source?.type || source.id == null) return line;
      const legacyTab = { products: 'products', policy_review_reports: 'products',
        ocr_records: 'ocr', photos: 'photos' }[source.type];
      const target = source.type === 'opportunities' ? `opportunity-${source.id}` :
        source.type === 'actions' ? `work-action-${source.id}` : null;
      const selector = source.type === 'interactions' ? '.person360-timeline' :
        source.type === 'context_items' ? '.person360-context-grid' : null;
      if ((legacyTab && context.legacyCustomerId) || target || selector) {
        line.append(button('打开来源', () => {
          if (legacyTab) return openLegacyTab(context.legacyCustomerId, legacyTab);
          const found = target ? document.getElementById(target) : document.querySelector(selector);
          (found || document.querySelector(target?.startsWith('opportunity') ?
            '.person360-opportunities' : '.person360-work-items'))?.scrollIntoView({ block: 'center' });
        }, 'btn-sm'));
      }
      return line;
    }
    function item(text, row) {
      const box = node('div', 'person360-insurance-item');
      box.append(node('p', '', text), sourceLine(row));
      return box;
    }
    function section(title, rows, empty, render) {
      const block = node('div', 'person360-insurance-block');
      block.append(node('h4', '', title));
      if (!rows.length) block.append(node('p', 'person360-muted', empty));
      for (const row of rows) block.append(render(row));
      insuranceBody.append(block);
    }
    section('Existing Coverage · 已录入保障', context.existingCoverage || [],
      '未知：尚无已录入保单明细；不能据此判断没有保障。', row =>
        item(`${row.label}：保额 ${row.amount ?? '未知'}，年缴保费 ${row.premium ?? '未知'}`, row));
    const reviewRows = [];
    if (context.review?.latest) reviewRows.push({ label: '最近检视',
      text: `${context.review.latest.date || ''} ${context.review.latest.summary || '暂无摘要'}`,
      date: context.review.latest.date, source: context.review.latest.source,
      provenance: context.review.latest.provenance });
    for (const row of context.review?.ocr || []) reviewRows.push({ label: 'OCR',
      text: row.summary, createdAt: row.createdAt, source: row.source, provenance: row.provenance });
    for (const row of context.review?.evidence || []) reviewRows.push({ label: '资料',
      text: `${row.fileName || '未命名文件'}${row.note ? ` · ${row.note}` : ''}`,
      createdAt: row.createdAt, source: row.source, provenance: row.provenance });
    section('Review · 检视与依据', reviewRows,
      '未知：暂无相关检视报告、OCR 摘要或附件；未进行保单核验。', row =>
        item(`${row.label}：${row.text}`, row));
    section('Known Needs · 已记录需求', context.knownNeeds || [],
      '未知：暂无明确提及保险需求的沟通或已确认事实。', row => item(row.content, row));
    section('Potential Gaps · 待核实缺口', context.potentialGaps || [],
      '未知：无人工复核且有资料依据的缺口记录；不能据此判断保障充分。', row =>
        item(row.content, row));
    section('Open Opportunities · 进行中的保险机会', context.openOpportunities || [],
      '暂无进行中的保险机会；已关闭机会不计入。', row =>
        item(`${row.type} · ${row.status || '未分阶段'}${row.progress ? ` · ${row.progress}` : ''}`, row));
    section('Next Actions · 下一步行动', context.nextActions || [],
      '暂无已记录的保险相关行动；机会文字建议不等于已创建行动。', row =>
        item(`${row.title}${row.dueAt ? ` · 截止 ${String(row.dueAt).slice(0, 10)}` : ' · 截止未知'}`, row));
    if (context.legacyCustomerId) {
      const link = node('a', '', '打开原保单检视页面');
      link.href = `#/customer/${context.legacyCustomerId}`;
      insurance.append(link);
    }
  } catch (error) {
    insuranceBody.append(node('p', 'person360-error', `保险概览加载失败：${error.message}`));
  }

  const family = node('section', 'card person360-card');
  family.append(node('h3', '', t('sec_family_members')));
  if (!model.members.length) family.append(node('p', 'person360-muted', t('family_unknown_note')));
  for (const member of model.members) {
    const row = node('div', 'person360-member');
    const name = member.person?.display_name || '已删除的 Person';
    row.append(node('span', '', `${t(`family_relationship_${member.relationship_to_anchor}`) || ROLE_LABELS[member.relationship_to_anchor] || 'Other'} · ${name}`));
    row.append(button(t('family_remove_member'), async () => {
      try {
        const changed = await reviewHousehold('remove_member', { householdId: String(model.household.id),
          membershipId: String(member.id) }, `${name} · ${t('family_remove_member')}`);
        if (!changed) return;
        await renderPerson360({ root, personId, callFn, openLegacyTab });
      } catch (error) { window.alert(`${t('family_action_failed')}: ${error.message}`); }
    }, 'person360-remove'));
    family.append(row);
  }

  const add = node('div', 'person360-add');
  add.append(node('h4', '', t('family_add_member')));
  const searchInput = node('input');
  searchInput.type = 'search';
  searchInput.placeholder = t('family_member_search');
  searchInput.maxLength = 160;
  const searchLine = node('div', 'person360-row');
  const candidateList = node('div', 'person360-candidates');
  let chosen = null;
  const searchButton = button(t('family_resolve'), async () => {
    chosen = null;
    candidateList.replaceChildren();
    try {
      const result = await request('resolveHouseholdMember', { name: searchInput.value.trim() });
      if (!result.candidates.length) {
        candidateList.append(node('p', 'person360-muted', t('family_no_match')));
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
  attachLine.append(role, button(t('family_add_member'), async () => {
    if (!chosen) { window.alert(t('family_identity_note')); return; }
    try {
      const changed = await reviewHousehold('add_member', { householdId: model.household?.id || null,
        memberId: String(chosen.id), memberName: chosen.displayName || chosen.display_name, relationship: role.value },
      `${chosen.displayName || chosen.display_name} · ${ROLE_LABELS[role.value]}`);
      if (!changed) return;
      await renderPerson360({ root, personId, callFn, openLegacyTab });
    } catch (error) { window.alert(`${t('family_action_failed')}: ${error.message}`); }
  }, 'btn-primary'));
  add.append(attachLine);
  family.append(add);
  wrap.append(family);

  const facts = node('section', 'card person360-card');
  facts.append(node('h3', '', t('sec_family_facts')));
  const textarea = node('textarea', 'person360-facts');
  textarea.value = model.household?.important_facts || '';
  textarea.maxLength = 2000;
  textarea.placeholder = t('family_facts_placeholder');
  facts.append(textarea, node('p', 'person360-muted', t('family_facts_confirm_note')));
  facts.append(button(t('family_review_and_save'), async () => {
    try {
      if (!model.household?.id) throw new Error(t('family_no_household_facts'));
      const changed = await reviewHousehold('save_facts', { householdId: String(model.household.id), facts: textarea.value }, textarea.value);
      if (!changed) return;
      await renderPerson360({ root, personId, callFn, openLegacyTab });
    } catch (error) { window.alert(`${t('family_action_failed')}: ${error.message}`); }
  }, 'btn-primary'));
  wrap.append(facts);
  root.replaceChildren(wrap);
  mountPersonWorkItems({root:workItems,personId,personName:model.person.display_name,
    callFn,isCurrent:() => location.hash === hash});
}

// 人物资料编辑面板：persons 域走 person_360.updatePerson；customers 域走 customers.update(editSource:'form')
async function openPersonEditor({ root, personId, callFn, openLegacyTab, model }) {
  const STAGES = ['', '新认识', '关系维护', '需求挖掘', '方案沟通', '成交推进', '转介绍经营'];
  const PRIORITIES = ['', 'A', 'B', 'C', 'D', 'E'];
  const MARITAL = ['', '未婚', '已婚', '未知'];

  const overlay = node('div', 'modal-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const form = node('div', 'modal');
  form.style.maxWidth = '760px';
  form.append(node('h3', '', '编辑人物资料'));
  const body = node('div', {}, node('div', 'loading', '正在载入资料…'));
  form.append(body);
  const footer = node('div', 'modal-footer');
  const cancelBtn = button('取消', () => overlay.remove());
  const saveBtn = button('保存', async () => {}, 'btn-primary');
  saveBtn.disabled = true;
  footer.append(cancelBtn, saveBtn);
  form.append(footer);
  overlay.append(form);
  document.getElementById('modal-root')?.appendChild(overlay) || document.body.appendChild(overlay);

  let profile;
  try {
    profile = await callFn('person_360', { action: 'getCustomerProfile', personId: String(personId) });
    if (!profile || profile.error) throw new Error(profile?.error || '资料加载失败');
  } catch (err) {
    body.replaceChildren(node('p', 'person360-error', `载入失败：${err.message}`));
    return;
  }
  const f = profile.fields || {};
  const linked = profile.status === 'linked';
  const customerId = profile.customerId;
  const expectedUpdatedAt = f.person_updated_at || model.person.updated_at || f.updated_at;

  const input = (value, max = 120) => {
    const el = node('input');
    el.maxLength = max; el.value = value == null ? '' : String(value); return el;
  };
  const numInput = (value) => {
    const el = node('input');
    el.type = 'number'; el.value = value == null ? '' : String(value); return el;
  };
  const dateInput = (value) => {
    const el = node('input');
    el.type = 'date'; el.value = String(value || '').slice(0, 10); return el;
  };
  const select = (options, value) => {
    const el = node('select');
    for (const v of options) {
      const opt = node('option', '', v || '—'); opt.value = v; el.append(opt);
    }
    el.value = value == null ? '' : String(value);
    return el;
  };
  const textarea = (value, max = 2000) => {
    const el = node('textarea');
    el.maxLength = max; el.value = value == null ? '' : String(value); return el;
  };
  const field = (label, ctrl, hint) => {
    const wrap = node('div', 'field');
    wrap.append(node('label', {}, label));
    if (hint) wrap.append(node('span', 'person360-muted', hint));
    wrap.append(ctrl);
    return wrap;
  };
  const row = (...children) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
    r.append(...children);
    return r;
  };

  // ---------- persons 域字段 ----------
  const nameInput = input(f.customer_name);
  const phoneInput = input(f.phone, 40);
  const wechatInput = input(f.wx_account, 80);
  const genderSel = select(['', '男', '女', '未知'], f.gender);
  const birthdayInput = dateInput(f.birthday);
  const occupationInput = input(f.occupation);
  const organizationInput = input(f.organization);
  const educationInput = input(f.education);
  const sourceInput = input(f.source, 120);
  const hobbiesTa = textarea(f.hobbies, 1000);
  const customerStageSel = select(STAGES, f.customer_stage);
  const priorities = ['', 'A', 'B', 'C', 'D', 'E'];
  const salesPrioritySel = select(priorities, f.sales_priority);
  const referralPrioritySel = select(priorities, f.referral_priority);
  const maritalSel = select(['', '未婚', '已婚', '未知'], f.marital_status);
  const firstContactInput = dateInput(f.first_contact_date);
  const notesTa = textarea(f.person_notes);

  const personSection = node('div', {});
  personSection.append(node('h4', '', t('sec_person_info')));
  personSection.append(
    field(t('field_name') + ' *', nameInput),
    row(field(t('field_phone'), phoneInput), field(t('field_birthday'), birthdayInput)),
    row(field(t('field_gender'), genderSel), field(t('field_wechat'), wechatInput)),
    row(field(t('field_occupation'), occupationInput), field(t('field_organization'), organizationInput), field(t('field_education'), educationInput)),
    row(field(t('field_source'), sourceInput), field(t('field_hobbies'), hobbiesTa)),
    row(field(t('field_customer_stage'), customerStageSel), field(t('field_sales_priority'), salesPrioritySel), field(t('field_referral_priority'), referralPrioritySel)),
    row(field(t('field_marital'), maritalSel), field(t('field_first_contact_date'), firstContactInput)),
    field(t('field_notes'), notesTa),
  );

  // ---------- customers 域字段（仅 linked 显示） ----------
  let customerSection = null;
  const custInputs = {};
  if (linked && customerId) {
    custInputs.additional_info = textarea(f.additional_info);
    custInputs.tags = input(f.tags);
    custInputs.annual_income = numInput(f.annual_income);
    custInputs.household_income = input(f.household_income);
    custInputs.properties_info = input(f.properties_info);
    custInputs.mbti = input(f.mbti);

    customerSection = node('div', {});
    customerSection.append(node('h4', '', t('sec_customer_specific_info')));
    customerSection.append(
      field(t('field_customer_notes'), custInputs.additional_info),
      row(field(t('field_customer_tags'), custInputs.tags), field('MBTI', custInputs.mbti)),
      row(field(t('field_income'), custInputs.annual_income), field(t('field_household_income'), custInputs.household_income)),
      field(t('field_properties'), custInputs.properties_info),
    );
  }

  body.replaceChildren(personSection);
  if (customerSection) body.append(customerSection);
  saveBtn.disabled = false;

  saveBtn.onclick = async () => {
    if (!nameInput.value.trim()) { window.alert('姓名必填'); return; }
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';

    // persons 域变更
    const personChanged = {};
    const pput = (key, val, orig) => { if (String(val ?? '') !== String(orig ?? '')) personChanged[key] = val; };
    pput('displayName', nameInput.value.trim(), f.customer_name);
    pput('phone', phoneInput.value.trim(), f.phone);
    pput('birthday', birthdayInput.value || null, String(f.birthday || '').slice(0, 10));
    pput('gender', genderSel.value || null, f.gender || '');
    pput('wechat', wechatInput.value.trim(), f.wx_account);
    pput('occupation', occupationInput.value.trim(), f.occupation);
    pput('organization', organizationInput.value.trim(), f.organization);
    pput('education', educationInput.value.trim(), f.education);
    pput('source', sourceInput.value.trim(), f.source);
    pput('hobbies', hobbiesTa.value.trim(), f.hobbies);
    pput('customerStage', customerStageSel.value, f.customer_stage || '');
    pput('salesPriority', salesPrioritySel.value, f.sales_priority || '');
    pput('referralPriority', referralPrioritySel.value, f.referral_priority || '');
    pput('maritalStatus', maritalSel.value, f.marital_status || '');
    pput('firstContactDate', firstContactInput.value || null, String(f.first_contact_date || '').slice(0, 10));
    pput('notes', notesTa.value, f.person_notes);

    // customers 域变更
    const custChanged = {};
    const cput = (key, val, orig) => { if (String(val ?? '') !== String(orig ?? '')) custChanged[key] = val; };
    if (linked && customerId) {
      cput('additional_info', custInputs.additional_info.value, f.additional_info);
      cput('tags', custInputs.tags.value.trim(), f.tags);
      cput('annual_income', custInputs.annual_income.value === '' ? null : Number(custInputs.annual_income.value), f.annual_income);
      cput('household_income', custInputs.household_income.value.trim(), f.household_income);
      cput('properties_info', custInputs.properties_info.value.trim(), f.properties_info);
      cput('mbti', custInputs.mbti.value.trim(), f.mbti);
    }

    try {
      if (Object.keys(personChanged).length) {
        // 后端 dispatcher 取 event.data（与 console write.js 一致），参数必须包在 data 里
        const res = await callFn('person_360', {
          action: 'updatePerson',
          data: { personId: String(personId), expectedUpdatedAt, ...personChanged },
        });
        if (!res || res.error || res.ok === false) {
          throw new Error((res && (res.message || res.error)) || '人物资料保存失败');
        }
      }
      if (Object.keys(custChanged).length) {
        const res = await callFn('customers', {
          action: 'update', id: Number(customerId), data: custChanged, editSource: 'form',
        });
        if (!res || res.error) {
          throw new Error((res && (res.message || res.error)) || '客户资料保存失败');
        }
      }
      overlay.remove();
      await renderPerson360({ root, personId, callFn, openLegacyTab });
    } catch (err) {
      window.alert(`保存失败：${err.message}`);
      saveBtn.disabled = false; saveBtn.textContent = '保存';
    }
  };
}
