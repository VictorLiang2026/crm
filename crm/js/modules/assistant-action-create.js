import { createApi } from '../core/api.js';
import { t } from './console/i18n.js';

const PAGE = '#/assistant/actions/new';
const errors = {
  INVALID_COMMAND: 'assistant_create_invalid',
  DUPLICATE_ACTION: 'assistant_create_duplicate',
  PREVIEW_STALE: 'assistant_create_stale',
  CONFIRMATION_REQUIRED: 'assistant_create_confirmation_expired',
};
const format = (key, values) => Object.entries(values).reduce((value, [name, text]) =>
  value.replaceAll(`{${name}}`, String(text ?? '')), t(key));

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
  const back = el('a', '', t('assistant_create_back')); back.href = '#/ai';
  page.append(back, el('h2', '', t('assistant_create_title')),
    el('p', 'crm-action-help', t('assistant_create_intro')));
  const notice = el('p', 'crm-action-notice'); notice.setAttribute('aria-live', 'polite');
  const searchForm = el('form', 'crm-action-search');
  const name = el('input'); name.required = true; name.maxLength = 100;
  name.placeholder = t('assistant_create_name_placeholder');
  name.setAttribute('aria-label', t('assistant_create_person_search'));
  const searchButton = el('button', 'btn', t('assistant_create_find_person')); searchButton.type = 'submit';
  searchForm.append(name, searchButton);
  const choices = el('div', 'crm-action-choices');
  const selected = el('p', 'crm-action-selected', t('assistant_create_no_person'));
  const form = el('form', 'crm-action-form');
  const type = el('select');
  for (const [value, labelKey] of [['followup','test_action_type_followup'], ['call','test_action_type_call'], ['meeting','test_action_type_meeting'], ['other','test_action_type_other']]) {
    const option = el('option', '', t(labelKey)); option.value = value; type.append(option);
  }
  field(form, t('assistant_create_action_type'), type);
  const title = el('input'); title.required = true; title.maxLength = 200;
  field(form, t('assistant_create_title_field'), title);
  const description = el('textarea'); description.maxLength = 4000;
  field(form, t('assistant_create_description'), description);
  const due = el('input'); due.type = 'datetime-local';
  field(form, t('assistant_create_due'), due);
  const priority = el('select');
  for (const [value, labelKey] of [['medium','priority_medium'], ['low','priority_low'], ['high','priority_high'], ['urgent','priority_urgent']]) {
    const option = el('option', '', t(labelKey)); option.value = value; priority.append(option);
  }
  field(form, t('assistant_create_priority'), priority);
  const planButton = el('button', 'btn btn-primary', t('assistant_create_plan')); planButton.type = 'submit';
  form.append(planButton);
  const progress = el('div', 'crm-action-progress');
  const previewButton = el('button', 'btn', t('assistant_create_preview')); previewButton.disabled = true;
  const confirmButton = el('button', 'btn', t('assistant_create_confirm')); confirmButton.disabled = true;
  const executeButton = el('button', 'btn btn-primary', t('assistant_create_execute')); executeButton.disabled = true;
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
  function fail(error) { status(t(errors[error?.message] || 'assistant_create_failed'), true); }
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
      person = null; resetPlan(); selected.textContent = t('assistant_create_no_person');
      choices.replaceChildren(); status(t('assistant_create_searching'));
      const response = await api.call('person_360', { action: 'search', name: name.value.trim() });
      if (!active()) return;
      if (!Array.isArray(response?.candidates)) throw new Error('SEARCH_FAILED');
      if (!response.candidates.length) { status(t('assistant_create_no_matches')); return; }
      for (const candidate of response.candidates) {
        if (!/^[1-9][0-9]*$/.test(String(candidate.id))) continue;
        const choice = el('button', 'btn', `${candidate.display_name} · #${candidate.id}`);
        choice.type = 'button';
        choice.addEventListener('click', () => {
          person = candidate; resetPlan();
          selected.textContent = format('test_action_selected', { name: candidate.display_name, id: candidate.id });
          status(t('assistant_create_choose_action'));
        });
        choices.append(choice);
      }
      if (response.hasMore) status(t('assistant_create_refine_name'), true);
      else status(t('assistant_create_choose_person'));
    });
  });
  for (const input of [type, title, description, due, priority]) {
    input.addEventListener('input', () => { if (commandId) { resetPlan(); status(t('assistant_create_changed')); } });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!person || busy) { status(t('assistant_create_select_first'), true); return; }
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
      status(t('assistant_create_planned'));
    });
  });
  previewButton.addEventListener('click', () => run(previewButton, async () => {
    if (!commandId) return;
    const result = await request('preview', { resource: 'actions', commandId });
    if (!active()) return;
    previewHash = result.previewHash;
    confirmButton.disabled = false; executeButton.disabled = true;
    preview.replaceChildren(el('h3', '', t('assistant_create_before')),
      el('p', '', format('test_action_preview_person', { name: result.preview.person.displayName, id: result.preview.person.id })),
      el('p', '', format('test_action_preview_title_field', { title: result.preview.after.title })),
      el('p', '', format('test_action_preview_type_field', {
        type: t(`test_action_type_${result.preview.after.action_type}`),
        priority: t(`priority_${result.preview.after.priority}`),
      })),
      el('p', '', format('test_action_preview_due', { due: result.preview.after.due_at ? new Date(result.preview.after.due_at).toLocaleString() : t('assistant_create_not_set') })),
      el('p', '', format('test_action_preview_description', { description: result.preview.after.description || t('assistant_create_not_filled') })));
    status(t('assistant_create_preview_review'));
  }));
  confirmButton.addEventListener('click', () => run(confirmButton, async () => {
    if (!commandId || !previewHash) return;
    await request('confirm', { resource: 'actions', commandId, previewHash });
    if (!active()) return;
    confirmButton.disabled = true; executeButton.disabled = false;
    status(t('assistant_create_confirmed'));
  }));
  executeButton.addEventListener('click', () => run(executeButton, async () => {
    if (!commandId || !previewHash) return;
    const result = await request('execute', { resource: 'actions', commandId });
    if (!active()) return;
    executed = true;
    previewButton.disabled = confirmButton.disabled = executeButton.disabled = planButton.disabled = true;
    status(format('test_action_created', { id: result.actionId }));
  }));
  if(scenario) {
    planButton.disabled=searchButton.disabled=true;
    void api.call('assistant',{action:'testSamples',stage:'status'}).then(result=>{
      if(!active())return;
      if(!result?.ok||!result.ready)throw Error('SEED_FORBIDDEN');
      name.value=t('test_action_sample_name');
      title.value=t('test_action_sample_title');
      description.value=t('test_action_sample_description');
      type.value='other';planButton.disabled=searchButton.disabled=false;
      status(t('assistant_create_test_prefilled'));
    }).catch(()=>{if(active())status(t('assistant_create_test_unavailable'),true);});
  }
}
