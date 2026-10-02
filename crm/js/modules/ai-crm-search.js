import { renderTestDataNotice } from './test-data-notice.js';
import { createApi } from '../core/api.js';

const PAGE_HASH = '#/ai/search';
const EXAMPLES = [
  '最近三个月参加过活动但没有继续跟进的人',
  '有孩子、最近关注教育、但还没谈保险的人',
  '最近关系下降的重点客户',
];
const LABELS = {
  activity_no_followup: '实际参加活动后未见跟进',
  child_education_no_insurance: '已确认子女关系、教育记录、未见保险记录',
  declining_priority: '重点客户的关系趋势下降',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function stylesheet() {
  if (document.getElementById('crm-ai-search-css')) return;
  const link = document.createElement('link');
  link.id = 'crm-ai-search-css';
  link.rel = 'stylesheet';
  link.href = '/crm/css/ai-crm-search.css';
  document.head.append(link);
}

function evidenceFor(row, template) {
  if (template === 'activity_no_followup') {
    return `到场记录 #${row.participant_id} · 活动 #${row.activity_id} · ${row.activity_date}`;
  }
  if (template === 'child_education_no_insurance') {
    return `已确认家庭成员 #${row.child_member_id} · 教育来源 public.${row.education_source_table} #${row.education_source_id} · ${row.education_date}`;
  }
  return `客户优先级 ${row.sales_priority} · 关系记录 #${row.relationship_id} · 趋势 ${row.trend}`;
}

export function renderAiCrmSearch({ root, callFn }) {
  stylesheet();
  const api = createApi(callFn);
  const page = node('section', 'crm-ai crm-ai-search');
  const back = node('a', 'crm-ai-search-back', '← 返回首页');
  back.href = '#/';
  page.append(back, node('h2', '', 'AI CRM 搜索'),
    node('p', 'crm-ai-search-intro', '用自然语言描述要找的人。AI 只解析条件；名单和来源由 CRM 数据库计算。'));

  const form = node('form', 'crm-ai-search-form');
  const input = node('textarea', 'crm-ai-search-input');
  input.rows = 3;
  input.maxLength = 1000;
  input.placeholder = '例如：最近三个月参加过活动但没有继续跟进的人';
  input.setAttribute('aria-label', '搜索问题');
  const submit = node('button', 'btn btn-primary', '搜索');
  submit.type = 'submit';
  form.append(input, submit);
  page.append(form);

  const examples = node('div', 'crm-ai-search-examples');
  examples.append(node('span', '', '试试这些问题：'));
  for (const sample of EXAMPLES) {
    const button = node('button', 'btn btn-sm', sample);
    button.type = 'button';
    button.addEventListener('click', () => { input.value = sample; input.focus(); });
    examples.append(button);
  }
  page.append(examples);
  const output = node('div', 'crm-ai-search-output');
  output.setAttribute('aria-live', 'polite');
  page.append(output);
  root.replaceChildren(page);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) { output.replaceChildren(node('p', 'crm-ai-search-alert', '请输入搜索问题。')); return; }
    submit.disabled = true;
    output.replaceChildren(node('p', 'loading', '正在解析条件并查询 CRM…'));
    try {
      const result = await api.call('assistant', { action: 'search', query });
      if (location.hash !== PAGE_HASH) return;
      if (!result?.ok) throw new Error(result?.error?.code || 'SEARCH_FAILED');
      output.replaceChildren();
      if (result.status === 'unsupported') {
        output.append(node('p', 'crm-ai-search-alert', result.notice));
        return;
      }
      if (result.status !== 'complete' || !Array.isArray(result.rows)) {
        throw new Error('INVALID_RESULT');
      }
      const heading = node('div', 'crm-ai-search-summary');
      heading.append(node('strong', '', LABELS[result.criteria?.template] || '受限条件'),
        node('span', '', `最近 ${result.criteria?.months} 个月 · 数据库匹配 ${result.total} 人`));
      output.append(heading);
      renderTestDataNotice(output, result.testData);
      for (const notice of result.notices || []) {
        output.append(node('p', 'crm-ai-search-alert', notice));
      }
      if (!result.rows.length) {
        output.append(node('p', 'crm-ai-search-empty',
          '当前没有可核实的匹配记录；这不代表现实中没有符合条件的人。'));
      }
      const list = node('div', 'crm-ai-search-results');
      for (const row of result.rows) {
        if (!/^[1-9][0-9]*$/.test(String(row.person_id))) continue;
        const card = node('article', 'crm-ai-search-person');
        const link = node('a', 'crm-ai-search-name', row.display_name || `Person #${row.person_id}`);
        link.href = `#/person/${row.person_id}`;
        card.append(link, node('small', 'crm-ai-search-evidence',
          evidenceFor(row, result.criteria.template)));
        list.append(card);
      }
      output.append(list);
      if (result.total > result.rows.length) {
        output.append(node('p', 'crm-ai-search-muted', `先显示 ${result.rows.length} 人，请缩小问题范围。`));
      }
      output.append(node('p', 'crm-ai-search-muted',
        '来源：public CRM 记录。AI 没有生成人物名单，也没有修改客户资料。'));
    } catch (error) {
      if (location.hash === PAGE_HASH) output.replaceChildren(node('p', 'crm-ai-search-alert',
        `搜索未完成（${String(error?.message || error).slice(0, 80)}）。请稍后重试。`));
    } finally { submit.disabled = false; }
  });
}
