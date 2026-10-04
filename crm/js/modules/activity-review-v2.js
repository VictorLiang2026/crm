import { renderTestDataNotice } from './test-data-notice.js';
// AI-native activity review preview. The existing callFn bridge provides login.
const SECTIONS = [
  ['whoMattered', 'Who mattered? · 哪些人值得关注'],
  ['whatChanged', 'What changed? · 有哪些变化'],
  ['relationshipsImproved', 'Which relationships improved? · 哪些关系可能改善'],
  ['signalsAppeared', 'Which signals appeared? · 出现哪些信号'],
  ['opportunitiesAppeared', 'Which opportunities appeared? · 发现哪些机会线索'],
  ['followUpPeople', 'Who requires follow-up? · 谁需要后续联系'],
];

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}

function refsOf(item) {
  return node('small', 'activity-review-v2-source', item.sourceRefs.length
    ? `来源：${item.sourceRefs.join('、')}` : '来源不足，需人工核实');
}

function input(label, value, multiline = false) {
  const wrapper = node('label', 'activity-review-v2-field');
  wrapper.append(node('span', '', label));
  const control = node(multiline ? 'textarea' : 'input');
  control.value = value ?? '';
  if (!multiline) control.type = 'text';
  wrapper.append(control);
  return { wrapper, control };
}

function localTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
}

function asInstant(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('请填写有效日期时间');
  return date.toISOString();
}

function reviewEditor({ root, callFn, activityId, resultId, candidate, operation, testData }) {
  const editor = node('div', 'activity-review-v2-editor');
  let draft;
  const controls = {};
  if (operation === 'action') {
    controls.title = input('行动标题', candidate.title);
    controls.description = input('具体依据与说明', candidate.reason, true);
    controls.dueAt = input('截止时间（可留空）', '');
    controls.dueAt.control.type = 'datetime-local';
    controls.priority = input('优先级 low / medium / high / urgent', 'medium');
  } else if (operation === 'opportunity') {
    controls.reason = input('机会理由', candidate.reason, true);
    controls.nextAction = input('建议下一步', candidate.nextAction, true);
    editor.append(node('p', 'activity-review-v2-note',
      `机会类型：${candidate.opportunityType}。审核后只建立待确认候选，正式机会仍需在 Person 360 经 WP10 预览确认。`));
  } else if (operation === 'outcome') {
    controls.outcomeType = input('结果类型', 'activity_review');
    controls.result = input('实际结果', testData?.containsTestData
      ? '【系统测试·勿联系】虚构活动复盘结果，仅用于系统验收，无真实联系或外发。' : '', true);
    controls.occurredAt = input('实际发生时间', localTime());
    controls.occurredAt.control.type = 'datetime-local';
  }
  for (const value of Object.values(controls)) editor.append(value.wrapper);
  const status = node('p', 'activity-review-v2-note');
  status.setAttribute('role', 'status');
  const previewBox = node('div', 'activity-review-v2-preview');
  function readDraft() {
    if (operation === 'action') return {
      title:controls.title.control.value,description:controls.description.control.value,
      dueAt:asInstant(controls.dueAt.control.value),priority:controls.priority.control.value,
    };
    if (operation === 'opportunity') return {
      type:candidate.opportunityType,reason:controls.reason.control.value,
      nextAction:controls.nextAction.control.value,
    };
    if (operation === 'outcome') return {
      outcomeType:controls.outcomeType.control.value,result:controls.result.control.value,
      occurredAt:asInstant(controls.occurredAt.control.value),
    };
    return {};
  }
  async function preview(targetOperation = operation) {
    status.textContent = '正在核对服务端预览…';
    previewBox.replaceChildren();
    try {
      draft = targetOperation.startsWith('reject_') ? {} : readDraft();
      const response = await callFn('person_360', {action:'previewActivityReview',data:{
        idempotencyKey:crypto.randomUUID(),operation:targetOperation,activityId,
        resultId:targetOperation==='outcome'?null:resultId,
        candidateIndex:targetOperation==='outcome'?null:candidate.sourceIndex,draft,
      }});
      if (!response || response.error || !response.previewId || response.businessDataWritten !== false)
        throw new Error(response?.error || '服务端预览失败');
      status.textContent = '服务端预览 · 请核对后人工确认；预览 15 分钟内有效。';
      previewBox.append(node('p', '', `操作：${targetOperation}；活动 #${activityId}`),
        node('p', '', response.personId ? `Person #${response.personId}` : '活动结果'),
        node('p', '', `内容：${JSON.stringify(response.after)}`),
        node('p', '', `来源：${(response.sourceRefs || []).join('、') || '人工记录的活动事实'}`));
      const confirm = node('button', 'btn btn-primary', '确认以上内容并执行');
      confirm.type = 'button';
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        status.textContent = '正在执行人工确认…';
        try {
          const saved = await callFn('person_360', {
            action:'executeActivityReview',previewId:response.previewId,
          });
          if (!saved || saved.error) throw new Error(saved?.error || '执行失败');
          status.textContent = saved.status === 'rejected' ? '候选已拒绝' :
            saved.kind === 'action' ? `行动 #${saved.actionId} 已保存` :
            saved.kind === 'opportunity' ? `机会候选 #${saved.candidateId} 已保存；请到 Person 360 继续审核` :
              saved.kind === 'outcome' ? `活动结果 #${saved.outcomeId} 已保存` : '候选已拒绝';
          if (testData?.containsTestData) status.textContent += '。含测试数据。';
          previewBox.replaceChildren();
          if (saved.personId) {
            const link = node('a', 'btn', '打开 Person 360');
            link.href = `#/person/${saved.personId}`;
            previewBox.append(link);
          }
        } catch (error) { status.textContent = `执行失败：${error.message}。请重新预览。`; }
      });
      previewBox.append(confirm);
    } catch (error) { status.textContent = `预览失败：${error.message}`; }
  }
  const controlsRow = node('div', 'activity-review-v2-controls');
  const previewButton = node('button', 'btn', '生成服务端预览');
  previewButton.type = 'button';
  previewButton.addEventListener('click', () => preview());
  controlsRow.append(previewButton);
  if (operation === 'action' || operation === 'opportunity') {
    const reject = node('button', 'btn', '拒绝候选预览');
    reject.type = 'button';
    reject.addEventListener('click', () => preview(`reject_${operation}`));
    controlsRow.append(reject);
  }
  editor.append(controlsRow,status,previewBox);
  root.append(editor);
}

export async function renderActivityRelationshipReview({ root, activityId, callFn }) {
  root.replaceChildren(node('div', 'loading', '正在生成关系复盘预览…'));
  let response;
  try {
    response = await callFn('ai_activity', { action: 'postReviewV2', activity_id: activityId });
    if (!response || response.error) throw new Error(response?.message || response?.error || '复盘失败');
    if (!response.review || !response.requires_confirmation || response.business_data_written !== false) {
      throw new Error('复盘结果格式异常');
    }
  } catch (error) {
    if (root.isConnected) root.replaceChildren(node('div', 'empty', `关系复盘暂不可用：${error.message}`));
    return;
  }
  if (!root.isConnected) return;
  const review = response.review;
  const card = node('section', 'card activity-review-v2');
  card.append(node('h3', '', '关系复盘 · AI 预览'),
    node('p', 'activity-review-v2-note', '以下是待核实的分析和行动候选；未修改 Person、Interaction、Action 或 Opportunity。'),
    node('p', 'activity-review-v2-summary', review.summary));
  for (const [key, label] of SECTIONS) {
    const section = node('section', 'activity-review-v2-section');
    section.append(node('h4', '', label));
    const items = Array.isArray(review[key]) ? review[key] : [];
    if (!items.length) section.append(node('p', 'activity-review-v2-muted', '暂无有来源支持的判断。'));
    else {
      const list = node('ul');
      for (const item of items) {
        const row = node('li');
        row.append(node('span', '', item.text), refsOf(item));
        list.append(row);
      }
      section.append(list);
    }
    card.append(section);
  }
  const actions = node('section', 'activity-review-v2-section');
  actions.append(node('h4', '', 'Action Candidate · 待人工审核'));
  const candidates = Array.isArray(review.actionCandidates) ? review.actionCandidates : [];
  if (!candidates.length) actions.append(node('p', 'activity-review-v2-muted', '暂无可关联到已确认 Person 的行动候选。'));
  for (const candidate of candidates) {
    const row = node('div', 'activity-review-v2-candidate');
    row.append(node('strong', '', `${candidate.personName} · ${candidate.title}`),
      node('p', '', candidate.reason), refsOf(candidate));
    const audit = node('button', 'btn-sm', '逐项审核');
    audit.type = 'button';
    audit.addEventListener('click', () => {
      row.querySelector('.activity-review-v2-editor')?.remove();
      reviewEditor({root:row,callFn,activityId,resultId:response.result_id,
        candidate,operation:'action',testData:response.testData});
    });
    row.append(audit);
    actions.append(row);
  }
  card.append(actions);
  const opportunities = node('section', 'activity-review-v2-section');
  opportunities.append(node('h4', '', 'Opportunity Candidate · 待人工审核'));
  const opportunityCandidates = Array.isArray(review.opportunityCandidates)
    ? review.opportunityCandidates : [];
  if (!opportunityCandidates.length) opportunities.append(node('p', 'activity-review-v2-muted',
    '暂无有正面来源支持、可关联到已确认 Person 的机会候选。'));
  for (const candidate of opportunityCandidates) {
    const row = node('div', 'activity-review-v2-candidate');
    row.append(node('strong', '', `${candidate.personName} · ${candidate.opportunityType}`),
      node('p', '', candidate.reason), node('p', '', `建议下一步：${candidate.nextAction}`), refsOf(candidate));
    const audit = node('button', 'btn-sm', '逐项审核');
    audit.type = 'button';
    audit.addEventListener('click', () => {
      row.querySelector('.activity-review-v2-editor')?.remove();
      reviewEditor({root:row,callFn,activityId,resultId:response.result_id,
        candidate,operation:'opportunity',testData:response.testData});
    });
    row.append(audit);
    opportunities.append(row);
  }
  card.append(opportunities);
  const outcome = node('section', 'activity-review-v2-section');
  outcome.append(node('h4', '', '记录实际 Outcome'));
  outcome.append(node('p', 'activity-review-v2-note',
    '仅记录已经发生、由人核对的结果；不会自动改变机会或行动状态。'));
  reviewEditor({root:outcome,callFn,activityId,resultId:null,candidate:null,
    operation:'outcome',testData:response.testData});
  card.append(outcome);
  if (response.discarded_unsupported_items) card.append(node('p', 'activity-review-v2-note',
    `已过滤 ${response.discarded_unsupported_items} 条缺少有效来源或身份关联的 AI 内容。`));
  renderTestDataNotice(card, response.testData);
  root.replaceChildren(card);
}
