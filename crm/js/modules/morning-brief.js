import { createApi } from '/crm/js/core/api.js';

const node = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
};
const safeTarget = value => /^#\/(?:person|customer|recruit|activity)\/[1-9][0-9]*$/.test(String(value || ''))
  ? value : null;
const dateLabel = value => value ? String(value).slice(0, 10) : '未排期';

function link(item, label) {
  const target = safeTarget(item.target);
  if (!target) return node('span', '', label);
  const anchor = node('a', 'mb-link', label);
  anchor.href = target;
  return anchor;
}
function list(rows, describe, emptyText) {
  if (!Array.isArray(rows) || !rows.length) return node('p', 'mb-empty', emptyText);
  const ul = node('ul', 'mb-list');
  rows.forEach(item => {
    const li = node('li', 'mb-row');
    li.append(link(item, describe(item)));
    ul.append(li);
  });
  return ul;
}
function section(title, content) {
  const box = node('section', 'mb-section');
  box.append(node('h4', '', title), content);
  return box;
}
function render(result, root) {
  const value = result?.sections;
  if (result?.view !== 'morning' || !value || typeof value !== 'object') {
    throw new Error('晨间简报响应格式不完整');
  }
  const output = node('div', 'mb-output');
  const brief = node('div', 'mb-intro');
  brief.append(node('p', 'mb-headline', value.morningBrief?.headline || '请核对当前 CRM 记录。'),
    node('p', 'mb-guidance', `${value.morningBrief?.guidanceSource === 'ai' ? 'AI 工作建议' : '工作建议'}：${
      value.morningBrief?.guidance || '先核对已记录事实，再决定今天的行动。'}`));
  output.append(section('Morning Brief · 晨间摘要', brief));
  output.append(section('Top Actions · 优先行动', list(value.topActions,
    item => `${item.personName ? item.personName + ' · ' : ''}${item.title || '查看行动'} · ${item.whyNow || dateLabel(item.dueDate)}`,
    '当前记录中暂未列出优先行动。')));
  const commitments = node('div', 'mb-group');
  commitments.append(node('h5', '', '已逾期'), list(value.commitments?.overdue,
    item => `${item.personName || '人物'} · ${item.content} · ${dateLabel(item.dueAt)}`,
    '当前记录中没有逾期承诺。'));
  if (value.commitments?.hasMoreOverdue) commitments.append(node('p', 'mb-limit', '仅显示最早的 50 项逾期承诺。'));
  commitments.append(node('h5', '', '未来 3 天到期'), list(value.commitments?.dueSoon,
    item => `${item.personName || '人物'} · ${item.content} · ${dateLabel(item.dueAt)}`,
    '当前记录中没有未来 3 天到期的承诺。'));
  if (value.commitments?.hasMoreDueSoon) commitments.append(node('p', 'mb-limit', '仅显示最早的 50 项到期承诺。'));
  output.append(section('Commitments · 承诺', commitments));
  output.append(section('Upcoming · 近期安排', list(value.upcoming,
    item => `${dateLabel(item.date)} · ${item.kind === 'activity' ? '活动' : '行动'} · ${item.title}`,
    '当前记录中没有未来 7 天的活动或已排期行动。')));
  output.append(section('Risk · 待核实风险', list(value.risk,
    item => item.title, '当前读取的记录中没有逾期承诺或行动；仍需核对其他风险。')));
  output.append(section('Opportunities · 进行中机会', list(value.opportunities,
    item => `${item.personName || '人物'} · ${item.type || '机会'} · ${item.status || '状态未记录'}${
      item.nextAction ? ' · 下一步：' + item.nextAction : ''}`,
    '当前读取的记录中没有进行中机会。')));
  if (value.limits?.opportunities) output.append(node('p', 'mb-limit', '机会仅显示最近读取的部分记录。'));
  output.append(section('Need Confirmation · 待人工确认', list(value.needConfirmation,
    item => `${item.personName || '人物'} · ${item.type || '机会候选'} · ${item.reason || '请核实依据'}`,
    '当前读取的记录中没有待审核的机会候选。')));
  if (value.limits?.needConfirmation) output.append(node('p', 'mb-limit', '待确认候选仅显示最近读取的部分记录。'));
  root.querySelector('.mb-output')?.remove();
  root.append(output);
}

export function mountMorningBrief({ root, callFn }) {
  if (!root || typeof callFn !== 'function') throw new TypeError('晨间简报需要页面和登录接口');
  const api = createApi(callFn);
  root.replaceChildren();
  const heading = node('div', 'mb-heading');
  heading.append(node('h3', '', '晨间简报'));
  const button = node('button', 'btn btn-primary', '生成晨间简报');
  button.type = 'button';
  heading.append(button);
  const note = node('p', 'mb-note', '按需生成；事实来自当前 CRM 记录，建议需由你核实。不会修改业务资料。');
  const status = node('p', 'mb-status');
  root.append(heading, note, status);
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '正在整理今日记录…';
    try {
      const result = await api.call('today_coach', { action: 'daily_review', view: 'morning' });
      if (result?.error) throw new Error(result.error);
      render(result, root);
      status.textContent = `生成于 ${String(result.generated_at || '').replace('T', ' ').slice(0, 16)}`;
    } catch (error) {
      status.textContent = `晨间简报生成失败：${error.message}`;
    } finally { button.disabled = false; }
  });
}
