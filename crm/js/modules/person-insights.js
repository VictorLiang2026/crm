import { renderTestDataNotice } from './test-data-notice.js';

const LABELS = { followup:'客户跟进', recruit_followup:'增员跟进', activity_participation:'实际到场', manual:'人工互动' };
const ACTIVITY_LABELS = { invitation:'个别邀约（已有回应）', conversation:'实质沟通',
  speaker_cooperation:'嘉宾合作进展', post_event_followup:'活动后跟进' };
const CONTEXT = [['fact','Fact · 已记录事实'],['signal','Signal · 待核实信号'],['inference','Inference · 推断候选']];
function el(tag, cls, value) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value != null) n.textContent = String(value);
  return n;
}
function formatDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN') : '时间未记录';
}
export function renderPersonInsights({ root, personId, customerId, callFn, openLegacyTab, isCurrent = () => true }) {
  const timeline = el('section', 'card person360-card person360-timeline');
  const contexts = el('section', 'card person360-card person360-context');
  timeline.append(el('h3', '', '统一互动时间线'));
  contexts.append(el('h3', '', '上下文 · Fact / Signal / Inference'));
  const body = el('div', ''), contextBody = el('div', '');
  timeline.append(body); contexts.append(contextBody); root.append(timeline, contexts);
  let requested = 0;
  async function loadPage(page) {
    const serial = ++requested;
    body.replaceChildren(el('p', 'person360-muted', '正在读取最新互动…'));
    try {
      const result = await callFn('person_360', { action:'getTimelinePage', personId, page, pageSize:10 });
      if (!isCurrent() || serial !== requested) return;
      if (result?.error || !Array.isArray(result?.rows)) throw Error(result?.error || '数据格式异常');
      body.replaceChildren(); renderTestDataNotice(body, result.testData);
      if (!result.rows.length) body.append(el('p', 'person360-muted', '暂无可显示的互动。报名记录不等于实际到场。'));
      const list = el('ol', 'person360-timeline-list');
      for (const row of result.rows) {
        const item = el('li', 'person360-timeline-item');
        item.append(el('strong', '', (row.activityId && ACTIVITY_LABELS[row.type]) || LABELS[row.type] || row.type || '互动'),
          el('time', 'person360-muted', formatDate(row.at)), el('p', '', row.summary || '未填写摘要'),
          el('p', 'person360-muted', `来源：${row.source}`));
        let href = null, label = null;
        if (row.type === 'followup' && customerId) {
          href = `#/customer/${customerId}`; label = '到旧跟进页查看 / 编辑';
        } else if (row.activityId) { href = `#/activity/${row.activityId}`; label = '查看活动'; }
        else if (row.candidateId) { href = `#/recruit/${row.candidateId}`; label = '查看候选人'; }
        else if (row.type === 'recruit_followup') { href = '#/recruit'; label = '查看招募'; }
        if (href) {
          const link = el('a', '', label); link.href = href;
          if (row.type === 'followup') link.addEventListener('click', event => {
            if (typeof openLegacyTab !== 'function' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
            event.preventDefault(); openLegacyTab(customerId, 'followups');
          });
          item.append(link);
        }
        list.append(item);
      }
      body.append(list);
      const nav = el('div', 'person360-timeline-nav');
      const prev = el('button', 'btn', '上一页'); prev.type = 'button'; prev.disabled = page <= 1;
      prev.addEventListener('click', () => loadPage(page - 1));
      const next = el('button', 'btn', '下一页'); next.type = 'button'; next.disabled = !result.hasMore;
      next.addEventListener('click', () => loadPage(page + 1));
      nav.append(prev, el('span', 'person360-muted', `第 ${page} 页`), next);
      body.append(nav, el('p', 'person360-muted', '每次翻页重新读取原记录；编辑或删除旧跟进后，返回此页刷新即可同步。'));
    } catch {
      if (!isCurrent() || serial !== requested) return;
      body.replaceChildren(el('p', 'person360-error', '时间线加载失败，请重试。'));
      const retry = el('button', 'btn', '重新读取'); retry.type = 'button'; retry.addEventListener('click', () => loadPage(page)); body.append(retry);
    }
  }
  async function loadContext() {
    contextBody.replaceChildren(el('p', 'person360-muted', '正在读取上下文…'));
    try {
      const result = await callFn('person_360', { action:'getContextGroups', personId });
      if (!isCurrent()) return;
      if (result?.error || !result?.groups) throw Error('数据格式异常');
      contextBody.replaceChildren(); renderTestDataNotice(contextBody, result.testData);
      const grid = el('div', 'person360-context-grid');
      for (const [key,title] of CONTEXT) {
        const section = el('section', 'person360-context-column');
        section.append(el('h4', '', title));
        const rows = result.groups[key] || [];
        if (!rows.length) section.append(el('p', 'person360-muted', '暂无记录'));
        for (const row of rows) {
          const item = el('article', 'person360-context-item');
          item.append(el('strong', '', row.category || '未分类'), el('p', '', row.content || '未填写内容'),
            el('p', 'person360-muted', row.confirmed ? '已确认' : '未确认候选'),
            el('p', 'person360-muted', `来源：${row.source}${row.origin ? ` · 原始依据：${row.origin}` : ''}`),
            el('p', 'person360-muted', `最近更新：${formatDate(row.updatedAt)}`));
          if (row.validTo && Date.parse(row.validTo) < Date.now()) item.append(el('p', 'person360-muted', '已过有效期，需重新核实'));
          section.append(item);
        }
        grid.append(section);
      }
      contextBody.append(grid);
    } catch {
      if (!isCurrent()) return;
      contextBody.replaceChildren(el('p', 'person360-error', '上下文加载失败，请重试。'));
      const retry = el('button', 'btn', '重新读取'); retry.type = 'button'; retry.addEventListener('click', loadContext); contextBody.append(retry);
    }
  }
  void loadPage(1); void loadContext();
}
