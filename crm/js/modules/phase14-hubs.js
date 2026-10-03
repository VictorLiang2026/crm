// Phase 14 navigation surfaces. Existing business routes and write flows remain in admin.html.
const PERSON_HASH = '#/people';
const OPPORTUNITY_HASH = '#/opportunities';
const LEGACY_TABS = {
  followups: ['传统跟进', 'followups'],
  'policy-review': ['保单检视', 'products'],
  products: ['产品', 'products'],
  gifts: ['伴手礼', 'gifts'],
  photos: ['照片', 'photos'],
  ocr: ['OCR / AI 解析记录', 'ocr'],
};

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}
function link(label, hash, className = '') {
  const element = node('a', className, label);
  element.href = hash;
  return element;
}
function button(label, action) {
  const element = node('button', 'btn', label);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}
function page(root, title, intro) {
  const wrap = node('section', 'phase14-page');
  wrap.append(node('h2', '', title), node('p', 'phase14-intro', intro));
  root.replaceChildren(wrap);
  return wrap;
}
function checkResult(result) {
  if (!result || result.error || !Array.isArray(result.rows)) throw new Error(result?.error || '列表返回格式异常');
  return result;
}
function pager(host, current, hasMore, load) {
  const controls = node('div', 'phase14-pager');
  const prev = button('上一页', () => load(current - 1));
  prev.disabled = current <= 1;
  const next = button('下一页', () => load(current + 1));
  next.disabled = !hasMore;
  controls.append(prev, node('span', '', `第 ${current} 页`), next);
  host.append(controls);
}

export function renderPeople({ root, callFn }) {
  const wrap = page(root, '人', '以 Person 360 查看关系、互动与机会；传统客户列表仍在“更多”。');
  const search = node('form', 'phase14-search');
  const input = node('input');
  input.type = 'search'; input.maxLength = 40; input.placeholder = '搜索姓名或括号限定';
  input.setAttribute('aria-label', '搜索人物');
  const submit = node('button', 'btn btn-primary', '搜索');
  submit.type = 'submit';
  search.append(input, submit);
  const list = node('div', 'phase14-list');
  wrap.append(search, list);
  let keyword = '', requestId = 0;
  async function load(number) {
    const mine = ++requestId;
    list.replaceChildren(node('p', 'loading', '正在加载人物…'));
    try {
      const result = checkResult(await callFn('person_360', {
        action: 'listPeople', page: number, pageSize: 20, keyword,
      }));
      if (mine !== requestId || location.hash !== PERSON_HASH) return;
      list.replaceChildren();
      if (!result.rows.length) list.append(node('p', 'empty', '没有找到人物。可调整姓名再搜索。'));
      for (const person of result.rows) {
        const row = node('div', 'phase14-row');
        row.append(link(person.display_name || `人物 #${person.id}`, `#/person/${person.id}`, 'phase14-row-title'));
        const detail = [person.occupation, person.organization].filter(Boolean).join(' · ');
        if (detail) row.append(node('span', 'phase14-muted', detail));
        list.append(row);
      }
      pager(list, result.page, result.hasMore, load);
    } catch (error) {
      if (mine === requestId && location.hash === PERSON_HASH)
        list.replaceChildren(node('p', 'phase14-error', `人物列表加载失败：${error.message}`));
    }
  }
  search.addEventListener('submit', event => { event.preventDefault(); keyword = input.value.trim(); void load(1); });
  void load(1);
}

export function renderOpportunities({ root, callFn }) {
  const wrap = page(root, '机会', '查看现有机会，进入对应 Person 360 后再核实和处理。');
  const list = node('div', 'phase14-list');
  wrap.append(list);
  let requestId = 0;
  async function load(number) {
    const mine = ++requestId;
    list.replaceChildren(node('p', 'loading', '正在加载机会…'));
    try {
      const result = checkResult(await callFn('person_360', {
        action: 'listOpportunityDirectory', page: number, pageSize: 20,
      }));
      if (mine !== requestId || location.hash !== OPPORTUNITY_HASH) return;
      list.replaceChildren();
      if (!result.rows.length) list.append(node('p', 'empty', '暂无机会。'));
      for (const opportunity of result.rows) {
        const row = node('div', 'phase14-row');
        const person = opportunity.person;
        const target = person?.id ? `#/person/${person.id}` :
          (opportunity.customer_id ? `#/customer/${opportunity.customer_id}` : null);
        const title = `${opportunity.opportunity_type || '经营机会'} · ${opportunity.status || '待核实'}`;
        row.append(target ? link(title, target, 'phase14-row-title') : node('strong', 'phase14-row-title', title));
        row.append(node('span', 'phase14-muted', person?.display_name ||
          (opportunity.customer_id ? `旧客户 #${opportunity.customer_id}` : '关联人物待核对')));
        if (opportunity.next_action) row.append(node('p', 'phase14-row-note', opportunity.next_action));
        list.append(row);
      }
      pager(list, result.page, result.hasMore, load);
    } catch (error) {
      if (mine === requestId && location.hash === OPPORTUNITY_HASH)
        list.replaceChildren(node('p', 'phase14-error', `机会列表加载失败：${error.message}`));
    }
  }
  void load(1);
}

export function renderAssistantHub({ root }) {
  const wrap = page(root, 'AI助手', '从明确的任务进入；重要结果继续由人预览和确认。');
  const grid = node('div', 'phase14-grid');
  for (const [title, description, hash] of [
    ['AI CRM 搜索', '描述要查找的人，由数据库筛选结果。', '#/ai/search'],
    ['创建行动', '选择人物、预览、确认后创建。', '#/assistant/actions/new'],
    ['晨间简报', '在今日经营页按需生成。', '#/today'],
  ]) {
    const card = link(title, hash, 'phase14-tile');
    card.append(node('span', 'phase14-muted', description));
    grid.append(card);
  }
  wrap.append(grid);
}

export function renderMore({ root }) {
  const wrap = page(root, '更多', '旧功能继续保留原页面与地址。选择客户后可进入旧客户详情中的功能。');
  const grid = node('div', 'phase14-grid');
  for (const [title, hash, description] of [
    ['测试场景', '#/test-scenario', '受控生成 / 打开虚构测试场景'],
    ['传统客户列表', '#/customers', '原客户列表与详情'],
    ['传统跟进', '#/more/followups', '选择客户后进入旧跟进记录'],
    ['经营漏斗', '#/funnels', '原漏斗分析'],
    ['AI建议历史', '#/ai-suggestions', '原建议记录'],
    ['保单检视', '#/more/policy-review', '旧客户详情中的保单检视'],
    ['产品', '#/more/products', '旧客户详情中的产品资料'],
    ['伴手礼', '#/more/gifts', '旧客户详情中的伴手礼'],
    ['照片/OCR', '#/more/photos', '选择客户后可进入照片或 OCR 记录'],
    ['嘉宾资源', '#/speakers', '原嘉宾档案'],
    ['主题资源', '#/topics', '原活动主题'],
    ['招募目标', '#/recruit/goals', '原目标管理'],
    ['客户活动量', '#/activity/customer', '原客户经营活动量'],
    ['增员活动量', '#/activity/recruit', '原组织发展活动量'],
    ['客户回收站', '#/customers/trash', '原客户恢复入口'],
    ['增员回收站', '#/recruit/trash', '原候选人恢复入口'],
  ]) {
    const card = link(title, hash, 'phase14-tile');
    card.append(node('span', 'phase14-muted', description));
    grid.append(card);
  }
  wrap.append(grid);
}

export function renderLegacyPicker({ root, callFn, feature, openLegacyTab }) {
  const target = LEGACY_TABS[feature];
  if (!target) throw new Error('未知的旧功能入口');
  const wrap = page(root, target[0], '先选择客户，再打开原客户详情的对应功能；旧 URL 与记录保持不变。');
  const search = node('form', 'phase14-search');
  const input = node('input');
  input.type = 'search'; input.placeholder = '搜索客户姓名'; input.maxLength = 40;
  input.setAttribute('aria-label', '搜索客户');
  const submit = node('button', 'btn btn-primary', '搜索'); submit.type = 'submit';
  search.append(input, submit);
  if (feature === 'photos') search.append(link('切换到 OCR 记录', '#/more/ocr'));
  if (feature === 'ocr') search.append(link('切换到照片', '#/more/photos'));
  const list = node('div', 'phase14-list');
  wrap.append(link('← 更多', '#/more'), search, list);
  const route = `#/more/${feature}`;
  let keyword = '', requestId = 0;
  async function load(number) {
    const mine = ++requestId;
    list.replaceChildren(node('p', 'loading', '正在加载客户…'));
    try {
      const result = checkResult(await callFn('customers', {
        action: 'list', page: number, pageSize: 20, keyword,
      }));
      if (mine !== requestId || location.hash !== route) return;
      list.replaceChildren();
      if (!result.rows.length) list.append(node('p', 'empty', '没有找到客户。'));
      for (const customer of result.rows) {
        const row = node('div', 'phase14-row');
        row.append(node('strong', 'phase14-row-title', customer.customer_name || `客户 #${customer.Id}`),
          button(`打开${target[0]}`, () => openLegacyTab(customer.Id, target[1])));
        list.append(row);
      }
      pager(list, result.page, result.hasMore || result.total > number * result.pageSize, load);
    } catch (error) {
      if (mine === requestId && location.hash === route)
        list.replaceChildren(node('p', 'phase14-error', `客户列表加载失败：${error.message}`));
    }
  }
  search.addEventListener('submit', event => { event.preventDefault(); keyword = input.value.trim(); void load(1); });
  void load(1);
}
