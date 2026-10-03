import { createApi } from '../core/api.js';

const PAGE = '#/assistant/actions/new';
const errors = {
  INVALID_COMMAND: '填写的信息无效，请检查后重新规划。',
  DUPLICATE_ACTION: '已有相同标题和截止时间的待办行动，请核对后再建。',
  PREVIEW_STALE: '人物资料已变化，请重新规划并预览。',
  CONFIRMATION_REQUIRED: '确认已失效，请重新预览。',
};

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function field(form, label, input) {
  const wrap = el('label', 'crm-action-field');
  wrap.append(el('span', '', label), input);
  form.append(wrap);
  return input;
}
function addCss() {
  if (document.getElementById('crm-action-create-css')) return;
  const link = document.createElement('link');
  link.id = 'crm-action-create-css';
  link.rel = 'stylesheet';
  link.href = '/crm/css/assistant-action-create.css';
  document.head.append(link);
}

export function renderAssistantActionCreate({ root, callFn, scenario = false }) {
  addCss();
  const api = createApi(callFn);
  const page = el('section', 'crm-action-create');
  const back = el('a', '', '← 返回首页'); back.href = '#/';
  page.append(back, el('h2', '', '新建行动'),
    el('p', 'crm-action-help', '选择已存在的人物，规划并核对预览。只有点击最后的“执行创建”才会写入行动。'));
  const notice = el('p', 'crm-action-notice'); notice.setAttribute('aria-live', 'polite');
  const searchForm = el('form', 'crm-action-search');
  const name = el('input'); name.required = true; name.maxLength = 100;
  name.placeholder = '输入准确姓名或带括号的限定名';
  name.setAttribute('aria-label', '查找人物');
  const searchButton = el('button', 'btn', '查找人物'); searchButton.type = 'submit';
  searchForm.append(name, searchButton);
  const choices = el('div', 'crm-action-choices');
  const selected = el('p', 'crm-action-selected', '尚未选择人物');
  const form = el('form', 'crm-action-form');
  const type = el('select');
  for (const [value, label] of [['followup','跟进'], ['call','电话'], ['meeting','会面'], ['other','其他']]) {
    const option = el('option', '', label); option.value = value; type.append(option);
  }
  field(form, '行动类型', type);
  const title = el('input'); title.required = true; title.maxLength = 200;
  field(form, '标题', title);
  const description = el('textarea'); description.maxLength = 4000;
  field(form, '说明', description);
  const due = el('input'); due.type = 'datetime-local';
  field(form, '截止时间（可选）', due);
  const priority = el('select');
  for (const [value, label] of [['medium','普通'], ['low','低'], ['high','高'], ['urgent','紧急']]) {
    const option = el('option', '', label); option.value = value; priority.append(option);
  }
  field(form, '优先级', priority);
  const planButton = el('button', 'btn btn-primary', '1. 规划'); planButton.type = 'submit';
  form.append(planButton);
  const progress = el('div', 'crm-action-progress');
  const previewButton = el('button', 'btn', '2. 查看预览'); previewButton.disabled = true;
  const confirmButton = el('button', 'btn', '3. 确认预览'); confirmButton.disabled = true;
  const executeButton = el('button', 'btn btn-primary', '4. 执行创建'); executeButton.disabled = true;
  progress.append(previewButton, confirmButton, executeButton);
  const preview = el('section', 'crm-action-preview');
  page.append(notice, searchForm, choices, selected, form, progress, preview);
  root.replaceChildren(page);

  let person = null;
  let commandId = null;
  let previewHash = null;
  let busy = false;
  let executed = false;
  const active = () => location.hash === (scenario ? '#/test-scenario/action' : PAGE);
  function status(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle('error', isError);
  }
  function resetPlan() {
    commandId = null; previewHash = null; executed = false;
    preview.replaceChildren();
    previewButton.disabled = confirmButton.disabled = executeButton.disabled = true;
  }
  function fail(error) { status(errors[error?.message] || '操作未完成，请核对后重试。', true); }
  async function request(stage, extra) {
    const response = await api.call('assistant', { action: 'command', stage, ...extra });
    if (!response?.ok) throw new Error(response?.error?.code || 'ACTION_COMMAND_FAILED');
    return response;
  }
  async function run(button, work) {
    if (busy || !active()) return;
    busy = true; button.disabled = true;
    let succeeded = false;
    try { await work(); succeeded = true; } catch (error) { if (active()) fail(error); }
    finally {
      busy = false;
      if (active() && !executed && (!succeeded || button === searchButton || button === planButton)) {
        button.disabled = false;
      }
    }
  }
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    run(searchButton, async () => {
      person = null; resetPlan(); selected.textContent = '尚未选择人物';
      choices.replaceChildren(); status('正在查找…');
      const response = await api.call('person_360', { action: 'search', name: name.value.trim() });
      if (!active()) return;
      if (!Array.isArray(response?.candidates)) throw new Error('SEARCH_FAILED');
      if (!response.candidates.length) { status('没有匹配的人物。请先在 Person 360 核实身份。'); return; }
      for (const candidate of response.candidates) {
        if (!/^[1-9][0-9]*$/.test(String(candidate.id))) continue;
        const choice = el('button', 'btn', `${candidate.display_name} · #${candidate.id}`);
        choice.type = 'button';
        choice.addEventListener('click', () => {
          person = candidate; resetPlan();
          selected.textContent = `已选择：${candidate.display_name}（Person #${candidate.id}）`;
          status('请填写行动，再点击规划。');
        });
        choices.append(choice);
      }
      if (response.hasMore) status('匹配较多，请增加括号限定后重新查找。', true);
      else status('请选择正确的人物；系统不会按姓名自动决定。');
    });
  });
  for (const input of [type, title, description, due, priority]) {
    input.addEventListener('input', () => { if (commandId) { resetPlan(); status('内容已变化，请重新规划。'); } });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!person || busy) { status('请先人工选择人物。', true); return; }
    run(planButton, async () => {
      resetPlan();
      const changes = { action_type: type.value, title: title.value.trim(),
        description: description.value.trim(), priority: priority.value };
      if (due.value) changes.due_at = new Date(due.value).toISOString();
      const result = await request('plan', { command: {
        operation: 'create', resource: 'actions', personId: person.id, changes } });
      if (!active()) return;
      commandId = result.commandId;
      previewButton.disabled = false;
      status('已规划。请查看数据库核对后的预览。');
    });
  });
  previewButton.addEventListener('click', () => run(previewButton, async () => {
    if (!commandId) return;
    const result = await request('preview', { resource: 'actions', commandId });
    if (!active()) return;
    previewHash = result.previewHash;
    confirmButton.disabled = false; executeButton.disabled = true;
    preview.replaceChildren(el('h3', '', '创建前预览'),
      el('p', '', `人物：${result.preview.person.displayName}（#${result.preview.person.id}）`),
      el('p', '', `标题：${result.preview.after.title}`),
      el('p', '', `类型：${result.preview.after.action_type} · 优先级：${result.preview.after.priority}`),
      el('p', '', `截止：${result.preview.after.due_at ? new Date(result.preview.after.due_at).toLocaleString() : '未设置'}`),
      el('p', '', `说明：${result.preview.after.description || '未填写'}`));
    status('请核对预览。确认仅记录同意，尚不创建行动。');
  }));
  confirmButton.addEventListener('click', () => run(confirmButton, async () => {
    if (!commandId || !previewHash) return;
    await request('confirm', { resource: 'actions', commandId, previewHash });
    if (!active()) return;
    confirmButton.disabled = true; executeButton.disabled = false;
    status('已确认预览。点击“执行创建”后才会写入行动。');
  }));
  executeButton.addEventListener('click', () => run(executeButton, async () => {
    if (!commandId || !previewHash) return;
    const result = await request('execute', { resource: 'actions', commandId });
    if (!active()) return;
    executed = true;
    previewButton.disabled = confirmButton.disabled = executeButton.disabled = planButton.disabled = true;
    status(`行动已创建：#${result.actionId}。可在今日经营查看。`);
  }));
  if(scenario) {
    planButton.disabled=searchButton.disabled=true;
    void api.call('assistant',{action:'testSamples',stage:'status'}).then(result=>{
      if(!active())return;
      if(!result?.ok||!result.ready)throw Error('SEED_FORBIDDEN');
      name.value='【系统测试·勿联系】虚构体验甲';
      title.value='【系统测试·勿联系】下一步体验行动';
      description.value='【系统测试·勿联系】仅在系统内验证正常确认流程，不联系、不外发。';
      type.value='other';planButton.disabled=searchButton.disabled=false;
      status('已预填测试内容。请点击查找并确认人物，然后按原流程规划、预览、确认与执行。');
    }).catch(()=>{if(active())status('请先用授权测试账号生成场景。',true);});
  }
}
