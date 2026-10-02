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
    actions.append(row);
  }
  card.append(actions);
  if (response.discarded_unsupported_items) card.append(node('p', 'activity-review-v2-note',
    `已过滤 ${response.discarded_unsupported_items} 条缺少有效来源或身份关联的 AI 内容。`));
  renderTestDataNotice(card, response.testData);
  root.replaceChildren(card);
}
