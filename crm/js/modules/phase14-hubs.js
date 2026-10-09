// Phase 14 navigation surfaces. Existing business routes and write flows remain in admin.html.
import { mountOpportunityWorkflow } from './opportunity-workflow.js';
import { renderOpportunityCandidates } from './opportunity-candidates.js';
import { renderTestDataNotice } from './test-data-notice.js';
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
  const wrap = page(root, '人', 'Person 保存人物身份与通用资料；客户和增员是可独立拥有的角色。');
  const search = node('form', 'phase14-search');
  const input = node('input');
  input.type = 'search'; input.maxLength = 40; input.placeholder = '搜索姓名或括号限定';
  input.setAttribute('aria-label', '搜索人物');
  const submit = node('button', 'btn btn-primary', '搜索');
  submit.type = 'submit';
  const add = button('＋ 新增人', () => openPersonCommand({ callFn, onDone: id => {
    location.hash = `#/person/${id}`;
  } }));
  add.className = 'btn btn-primary';
  search.append(input, submit, add);
  const list = node('div', 'phase14-list');
  wrap.append(search, list);
  let keyword = '', requestId = 0, sortField = 'id', sortDir = 'desc';
  const headings = [
    ['编号', 'id'], ['姓名', 'display_name'], ['角色'], ['职业／机构'],
    ['最近更新', 'updated_at'], ['转客户'], ['转增员'],
  ];
  async function load(number) {
    const mine = ++requestId;
    list.replaceChildren(node('p', 'loading', '正在加载人物…'));
    try {
      const result = checkResult(await callFn('person_360', {
        action: 'listPeople', page: number, pageSize: 50, keyword, sortField, sortDir,
      }));
      if (mine !== requestId || location.hash !== PERSON_HASH) return;
      list.replaceChildren();
      const scroll = node('div', 'phase14-table-scroll');
      const table = node('table', 'phase14-people-table');
      const head = node('thead');
      const headRow = node('tr');
      for (const [label, field] of headings) {
        const th = node('th');
        if (field) {
          const active = sortField === field;
          const control = button(`${label}${active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`, () => {
            sortDir = sortField === field && sortDir === 'desc' ? 'asc' : 'desc';
            sortField = field;
            void load(1);
          });
          control.className = 'phase14-sort';
          control.setAttribute('aria-label', `${label}排序，当前${active ? (sortDir === 'asc' ? '升序' : '降序') : '未排序'}`);
          th.append(control);
          if (active) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        } else th.textContent = label;
        headRow.append(th);
      }
      head.append(headRow); table.append(head);
      const body = node('tbody');
      for (const person of result.rows) {
        const row = node('tr');
        const cell = (content) => { const td = node('td'); td.append(content); row.append(td); };
        cell(node('span', '', person.id));
        cell(link(person.display_name || `人物 #${person.id}`, `#/person/${person.id}`, 'phase14-row-title'));
        const roles = Array.isArray(person.roles) ? person.roles : [];
        cell(node('span', '', roles.map(role => ({ customer: '客户', recruit: '增员', speaker: '嘉宾', participant: '参与者', partner: '合作伙伴', referrer: '推荐人', alumni: '校友', other: '其他' })[role] || role).join(' · ') || '尚无角色'));
        cell(node('span', '', [person.occupation, person.organization].filter(Boolean).join('／') || '—'));
        cell(node('span', '', person.updated_at ? new Date(person.updated_at).toLocaleDateString('zh-CN') : '—'));
        const customerId = person.customer_id;
        const customerAction = customerId ? link('查看客户', `#/customer/${customerId}`) :
          button('转客户', () => openPersonCommand({ callFn, kind: 'customer', person, onDone: () => load(result.page) }));
        cell(customerAction);
        const recruitAction = person.recruit_id ? link('查看增员', `#/recruit/${person.recruit_id}`) :
          button('转增员', () => openPersonCommand({ callFn, kind: 'recruit', person, onDone: () => load(result.page) }));
        cell(recruitAction);
        body.append(row);
      }
      table.append(body); scroll.append(table); list.append(scroll);
      if (!result.rows.length) list.append(node('p', 'empty', '没有找到人物。可调整姓名再搜索，或人工新增。'));
      const controls = node('div', 'phase14-pager');
      const prev = button('上一页', () => load(result.page - 1)); prev.disabled = result.page <= 1;
      const next = button('下一页', () => load(result.page + 1)); next.disabled = result.page >= result.totalPages;
      controls.append(prev, node('span', '', `第 ${result.page}／${result.totalPages} 页 · 共 ${result.total} 人`), next);
      list.append(controls);
    } catch (error) {
      if (mine === requestId && location.hash === PERSON_HASH)
        list.replaceChildren(node('p', 'phase14-error', `人物列表加载失败：${error.message}`));
    }
  }
  search.addEventListener('submit', event => { event.preventDefault(); keyword = input.value.trim(); void load(1); });
  void load(1);
}

export function openPersonCommand({ callFn, kind = 'person', person = null, prefill = {}, onDone }) {
  const overlay = node('div', 'phase14-command-overlay');
  const dialog = node('section', 'phase14-command');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const actionTitle = ({ person: '＋ 人工新增人', customer: '人工确认 · 转客户',
    recruit: '人工确认 · 转增员', speaker: '人工确认 · 建嘉宾', capture: '快速记录 · 核对人物' })[kind];
  dialog.setAttribute('aria-label', actionTitle);
  const title = node('h3', '', actionTitle);
  const content = node('div');
  const status = node('p', 'phase14-muted', '先核对身份，再查看服务端预览。');
  const close = button('关闭', () => overlay.remove());
  dialog.append(title, content, status, close); overlay.append(dialog); document.body.append(overlay);
  let previewId = null;
  function fail(error) { status.className = 'phase14-error'; status.textContent = error.message || String(error); }
  function showPreview(result) {
    previewId = result.previewId;
    const p = result.preview;
    content.replaceChildren(node('p', '', `人物：${p.displayName}（${p.newPerson ? '新建主档' : `#${p.personId}`}）`),
      node('p', '', `本次将${p.willCreateCustomer ? '创建／关联客户；' : ''}${p.willCreateRecruit ? '创建／关联增员；' : ''}${p.willCreateSpeaker ? '创建嘉宾；' : ''}${p.willCreateInteraction ? '保存互动；' : ''}${kind === 'person' ? '仅建立人物身份。' : ''}`),
      node('p', 'phase14-muted', `预览有效至 ${new Date(result.expiresAt).toLocaleString('zh-CN')}。`));
    if (kind === 'capture') content.append(node('p', '', `交流原文：${String(prefill.note || '').slice(0, 300)}`));
    const confirm = button('确认以上内容并执行', async () => {
      confirm.disabled = true; status.textContent = '正在执行…';
      try {
        const saved = await callFn('person_360', { action: 'executeIdentity', data: { previewId } });
        if (saved?.error) throw new Error(saved.error);
        overlay.remove(); onDone?.(saved.personId, saved);
      } catch (error) { fail(error); confirm.disabled = false; }
    });
    confirm.className = 'btn btn-primary'; content.append(confirm);
    status.className = 'phase14-muted'; status.textContent = '请核对后人工确认；关闭不会写入。';
  }
  async function preview(data) {
    status.className = 'phase14-muted'; status.textContent = '正在生成服务端预览…';
    try {
      const result = await callFn('person_360', { action: 'previewIdentity',
        data: { kind, idempotencyKey: crypto.randomUUID(), ...data } });
      if (result?.error) throw new Error(result.error);
      showPreview(result);
    } catch (error) { fail(error); }
  }
  if (person) {
    content.append(node('p', '', `${person.display_name} · Person #${person.id}`),
      node('p', 'phase14-muted', kind === 'customer' ?
        '客户角色会建立旧客户详情所需的兼容档案。' :
        kind === 'recruit' ? '增员角色可独立于客户；不会自动创建客户。' :
          '嘉宾角色不要求客户档案。'));
    content.append(button('生成服务端预览', () => preview({ personId: person.id, displayName: person.display_name })));
  } else {
    const fields = [['姓名（可加括号限定）', 'displayName'], ['职业', 'occupation'],
      ['机构', 'organization'], ['教育', 'education']];
    const inputs = {};
    for (const [label, key] of fields) {
      const wrapper = node('label', 'phase14-field', label);
      const input = node('input'); input.type = 'text'; input.maxLength = key === 'displayName' ? 160 : 120;
      input.setAttribute('aria-label', label); input.value = String(prefill[key] || '');
      wrapper.append(input); content.append(wrapper); inputs[key] = input;
    }
    const customerChoice = node('label', 'phase14-choice');
    const customerCheckbox = node('input'); customerCheckbox.type = 'checkbox';
    if (kind === 'capture') {
      customerChoice.append(customerCheckbox, node('span', '', '同时转客户（可选；不勾选不会进入客户列表）'));
      content.append(customerChoice);
    }
    const candidates = node('div', 'phase14-candidates'); content.append(candidates);
    content.append(button('查找并核对 Person', async () => {
      candidates.replaceChildren(); status.textContent = '正在查找身份…';
      try {
        const found = await callFn('person_360', { action: 'resolveIdentity', name: inputs.displayName.value.trim() });
        if (found?.error) throw new Error(found.error);
        const options = [];
        for (const candidate of found.candidates) {
          options.push({ value: candidate.id, label: `选择已有 #${candidate.id} · ${candidate.displayName}${candidate.organization ? ` · ${candidate.organization}` : ''}` });
        }
        if (!found.hasMore && !found.deletedIdentity &&
            (found.status === 'available' || found.status === 'confirm_new_qualified' || found.canCreateAfterConfirmation)) {
          options.push({ value: 'new', label: '确认新建 Person（默认不创建客户）' });
        }
        const radioGroup = `identity-${crypto.randomUUID()}`;
        for (const option of options) {
          const label = node('label', 'phase14-choice');
          const radio = node('input'); radio.type = 'radio'; radio.name = radioGroup;
          radio.value = option.value; label.append(radio, node('span', '', option.label)); candidates.append(label);
        }
        if (found.hasMore || found.deletedIdentity) {
          candidates.append(node('p', 'phase14-error', found.deletedIdentity ?
            '发现已删除的同名身份，请先人工处理回收站身份。' : '同名候选超过显示上限，请加括号限定后重试。'));
        }
        if (!options.length) throw new Error('没有可安全选择的身份，请加括号限定后重试');
        const next = button('生成服务端预览', () => {
          const checked = candidates.querySelector('input:checked');
          if (!checked) { fail(new Error('请人工选择已有 Person 或明确确认新建')); return; }
          void preview({ ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()])),
            ...(checked.value === 'new' ? {} : { personId: checked.value }),
            ...(kind === 'capture' ? { note: prefill.note, summary: prefill.summary,
              customer: customerCheckbox.checked, speaker: prefill.speaker === true,
              ...(prefill.speakerId ? { speakerId: prefill.speakerId } : {}),
              ...(prefill.nextDate ? { nextDate: prefill.nextDate } : {}) } : {}) });
        });
        candidates.append(next); status.className = 'phase14-muted';
        status.textContent = '候选不会自动选中。请逐项核对后选择。';
      } catch (error) { fail(error); }
    }));
    inputs.displayName.focus();
  }
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') overlay.remove(); });
}

export function renderOpportunities({ root, callFn }) {
  const wrap = page(root, '机会', '机会候选先核对来源；Person 专属机会经服务端预览和人工确认处理。旧客户机会仍在原详情操作。');
  wrap.append(link('选择人物新增机会', '#/people', 'btn btn-primary'));
  const pending = node('div', 'phase14-list');
  const review = node('div', 'phase14-list');
  wrap.append(node('h3', '', '待审核候选'), pending, review, node('h3', '', '正式机会'));
  const list = node('div', 'phase14-list');
  const manager = node('div', 'phase14-list');
  wrap.append(list, manager);
  async function loadPending() {
    pending.replaceChildren(node('p','loading','正在读取候选…'));
    try {
      const result=await callFn('person_360',{action:'listPendingOpportunityCandidates'});
      if(result?.error||!Array.isArray(result?.rows))throw new Error(result?.error||'候选列表格式异常');
      if(location.hash!==OPPORTUNITY_HASH)return;
      pending.replaceChildren();renderTestDataNotice(pending,result.testData);
      if(!result.rows.length)pending.append(node('p','phase14-muted','暂无待审核机会候选。'));
      for(const candidate of result.rows){
        const card=node('div','phase14-row');
        card.append(node('strong','',`${candidate.personName} · 候选 #${candidate.id}`),
          node('p','',candidate.draft?.reason||'待核对依据'),
          node('p','phase14-muted',`来源：${(candidate.evidence||[]).join('、')}`),
          button('审核候选',()=>{
            review.replaceChildren();renderOpportunityCandidates({root:review,personId:candidate.person_id,
              callFn,onCreated:()=>{void loadPending();void load(1);}});
            review.scrollIntoView({block:'nearest'});
          }));
        pending.append(card);
      }
      if(result.hasMore)pending.append(node('p','phase14-muted','仅显示最近 20 条待审核候选。'));
    }catch(error){pending.replaceChildren(node('p','phase14-error',`候选加载失败：${error.message}`));}
  }
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
        if(opportunity.customer_id==null&&person?.id)row.append(button('管理机会',()=>{
          manager.replaceChildren();mountOpportunityWorkflow({root:manager,personId:person.id,
            personName:person.display_name,callFn,
            isCurrent:()=>location.hash===OPPORTUNITY_HASH,onChanged:()=>void load(number)});
          manager.scrollIntoView({block:'nearest'});
        }));
        list.append(row);
      }
      pager(list, result.page, result.hasMore, load);
    } catch (error) {
      if (mine === requestId && location.hash === OPPORTUNITY_HASH)
        list.replaceChildren(node('p', 'phase14-error', `机会列表加载失败：${error.message}`));
    }
  }
  void loadPending();
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
    ['账号与应用维护', '#/account', '修改密码、退出登录、强制加载最新版'],
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
