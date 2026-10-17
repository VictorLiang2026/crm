import { createApi } from '../core/api.js';
import { getLang, t } from './console/i18n.js';

const PAGE = '#/assistant/actions/change';
const FIELDS = ['action_type', 'title', 'description', 'due_at', 'priority'];
const LABELS = { action_type: 'action_change_type', title: 'action_change_title_field',
  description: 'action_change_description', due_at: 'action_change_due', priority: 'action_change_priority',
  status: 'action_change_status', completed_at: 'action_change_completed_at',
  completed_by_uid: 'action_change_completed_by' };
const ENUMS = { open: 'action_status_open', in_progress: 'action_status_in_progress',
  completed: 'action_status_completed', low: 'priority_low', medium: 'priority_medium',
  high: 'priority_high', urgent: 'priority_urgent' };
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = String(value);
  return node;
};
const text = value => value == null || value === '' ? t('action_change_empty') : String(value);
function addCss() {
  if (document.getElementById('crm-action-change-css')) return;
  const link = document.createElement('link'); link.id = 'crm-action-change-css';
  link.rel = 'stylesheet'; link.href = '/crm/css/assistant-action-change.css'; document.head.append(link);
}
function renderSnapshot(snapshot) {
  const grid = el('dl', 'crm-action-change-snapshot');
  const keys = ['status', ...FIELDS];
  if (snapshot && Object.hasOwn(snapshot, 'completed_at')) keys.push('completed_at');
  if (snapshot && Object.hasOwn(snapshot, 'completed_by_uid')) keys.push('completed_by_uid');
  for (const key of keys) {
    const term = el('dt', '', t(LABELS[key]));
    let value = snapshot?.[key];
    if (key === 'due_at' && value) {
      const date = new Date(value); value = Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
    }
    if (key === 'completed_at' && value) {
      const date = new Date(value); value = Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
    }
    if (key === 'priority' && value) value = t(ENUMS[value] || 'action_change_empty');
    if (key === 'status' && value) value = t(ENUMS[value] || 'action_change_empty');
    grid.append(term, el('dd', '', text(value)));
  }
  return grid;
}

export function renderAssistantActionChange({ root, callFn }) {
  addCss();
  const api = createApi(callFn);
  const page = el('section', 'crm-action-change');
  const back = el('a', 'crm-action-change-back', t('action_change_back')); back.href = '#/ai';
  page.append(back, el('h2', '', t('action_change_title')), el('p', 'crm-action-change-help', t('action_change_help')));
  const notice = el('p', 'crm-action-change-notice'); notice.setAttribute('aria-live', 'polite');
  const form = el('form', 'crm-action-change-request');
  const queryLabel = el('label', 'crm-action-change-query');
  queryLabel.append(el('span', '', t('action_change_query')));
  const query = el('textarea'); query.required = true; query.maxLength = 1200;
  query.placeholder = t('action_change_query_placeholder'); queryLabel.append(query);
  const interpret = el('button', 'btn btn-primary', t('action_change_interpret')); interpret.type = 'submit';
  form.append(queryLabel, interpret);
  const proposal = el('section', 'crm-action-change-proposal');
  const people = el('div', 'crm-action-change-choices');
  const actions = el('div', 'crm-action-change-choices');
  const testNotice = el('p', 'crm-action-change-test-notice'); testNotice.setAttribute('role', 'status');
  const controls = el('div', 'crm-action-change-controls');
  const plan = el('button', 'btn btn-primary', t('action_change_plan')); plan.type = 'button'; plan.disabled = true;
  const review = el('button', 'btn', t('action_change_review')); review.type = 'button'; review.disabled = true;
  const confirm = el('button', 'btn', t('action_change_confirm')); confirm.type = 'button'; confirm.disabled = true;
  const execute = el('button', 'btn btn-primary', t('action_change_execute')); execute.type = 'button'; execute.disabled = true;
  controls.append(plan, review, confirm, execute);
  const preview = el('section', 'crm-action-change-preview');
  page.append(notice, form, proposal, el('h3', '', t('action_change_person')), people, testNotice,
    el('h3', '', t('action_change_action')), actions, controls, preview);
  root.replaceChildren(page);

  let parsed = null, person = null, target = null, commandId = null, previewHash = null;
  let busy = false, completed = false;
  const active = () => location.hash === PAGE;
  function setStatus(message, error = false) { notice.textContent = message; notice.classList.toggle('error', error); }
  function clearCommand() {
    commandId = null; previewHash = null; preview.replaceChildren();
    review.disabled = confirm.disabled = execute.disabled = true; plan.disabled = !(parsed && person && target);
  }
  function resetFromRequest() {
    parsed = person = target = null; proposal.replaceChildren(); people.replaceChildren(); actions.replaceChildren();
    testNotice.textContent = '';
    plan.disabled = review.disabled = confirm.disabled = execute.disabled = true; clearCommand();
  }
  async function withBusy(button, work) {
    if (busy || !active() || completed) return;
    busy = true; button.disabled = true;
    try { await work(); }
    catch (_) { if (active()) setStatus(t('action_change_error'), true); }
    finally { busy = false; if (active() && !completed) button.disabled = false; }
  }
  function choosePerson(candidate, button) {
    if (busy) return;
    person = { id: String(candidate.id), displayName: candidate.displayName };
    target = null; clearCommand(); actions.replaceChildren();
    for (const item of people.querySelectorAll('button')) item.classList.toggle('selected', item === button);
    setStatus(t('action_change_pending'));
    void withBusy(button, async () => {
      const result = await api.call('assistant', { action: 'actionCommandTargets',
        personMention: parsed.proposal.personMention, selectedPersonId: person.id });
      if (!active()) return;
      if (!result?.ok) throw new Error('TARGETS_FAILED');
      person = result.person;
      if (result.testData?.status !== 'verified') {
        testNotice.textContent = t('action_change_test_unknown');
      } else if (result.testData.containsTestData) {
        testNotice.textContent = t('action_change_test_notice');
      } else testNotice.textContent = '';
      if (!Array.isArray(result.actions) || !result.actions.length) { setStatus(t('action_change_no_action'), true); return; }
      for (const action of result.actions) {
        const due = action.due_at ? new Date(action.due_at).toLocaleString() : t('action_change_empty');
        const option = el('button', 'btn crm-action-change-choice',
          `#${action.id} · ${action.title || t('action_change_empty')} · ${action.action_type || ''} · ${due} · ${t(ENUMS[action.status] || 'action_change_empty')}`);
        option.type = 'button'; option.addEventListener('click', () => {
          if (busy) return;
          target = { id: String(action.id), title: action.title || '' }; clearCommand();
          for (const item of actions.querySelectorAll('button')) item.classList.toggle('selected', item === option);
          setStatus(t('action_change_choose_action'));
        }); actions.append(option);
      }
      setStatus(t('action_change_choose_action'));
    });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    void withBusy(interpret, async () => {
      resetFromRequest(); setStatus(t('action_change_pending'));
      const result = await api.call('assistant', { action: 'actionCommandInterpret', query: query.value.trim(),
        language: getLang() === 'en' ? 'en' : 'zh-CN' });
      if (!active()) return;
      if (!result?.ok) throw new Error('INTERPRET_FAILED');
      parsed = result;
      if (result.status === 'unsupported') { setStatus(t('action_change_unsupported'), true); return; }
      if (result.status === 'needs_clarification') { setStatus(t('action_change_needs_clarification'), true); return; }
      if (result.status === 'person_not_found') { setStatus(t('action_change_no_person'), true); return; }
      proposal.append(el('p', '', result.proposal.interpretation),
        el('p', '', result.proposal.operation === 'close' ? t('action_change_close') : t('action_change_update')));
      if (result.status !== 'needs_person_selection' || !Array.isArray(result.candidates)) throw new Error('INVALID_RESULT');
      if (result.hasMore) { setStatus(t('action_change_needs_clarification'), true); return; }
      for (const candidate of result.candidates) {
        const detail = [candidate.organization, candidate.occupation].filter(Boolean).join(' · ');
        const button = el('button', 'btn crm-action-change-choice',
          `#${candidate.id} · ${candidate.displayName}${detail ? ` · ${detail}` : ''}`);
        button.type = 'button'; button.addEventListener('click', () => choosePerson(candidate, button)); people.append(button);
      }
      setStatus(t('action_change_choose_person'));
    });
  });
  plan.addEventListener('click', () => void withBusy(plan, async () => {
    if (!parsed || !person || !target) return;
    const cmd = { operation: parsed.proposal.operation, resource: 'actions', personId: person.id,
      targetActionId: target.id, changes: parsed.proposal.changes };
    const result = await api.call('assistant', { action: 'command', stage: 'plan', command: cmd });
    if (!active() || !result?.ok) throw new Error('PLAN_FAILED');
    commandId = result.commandId; review.disabled = false;
    setStatus(t('action_change_pending'));
  }));
  review.addEventListener('click', () => void withBusy(review, async () => {
    if (!commandId) return;
    const result = await api.call('assistant', { action: 'command', stage: 'preview', resource: 'actions', commandId });
    if (!active() || !result?.ok) throw new Error('PREVIEW_FAILED');
    previewHash = result.previewHash;
    const before = el('div', 'crm-action-change-column'); before.append(el('h4', '', t('action_change_before')), renderSnapshot(result.preview.before));
    const after = el('div', 'crm-action-change-column'); after.append(el('h4', '', t('action_change_after')), renderSnapshot(result.preview.after));
    const columns = el('div', 'crm-action-change-columns'); columns.append(before, after);
    const expiry = result.expiresAt ? new Date(result.expiresAt).toLocaleString() : t('action_change_empty');
    preview.replaceChildren(el('h3', '', `${person.displayName} · #${target.id} · ${target.title || t('action_change_empty')}`),
      el('p', 'crm-action-change-expiry', `${t('action_change_expires')}: ${expiry}`), columns);
    confirm.disabled = false; execute.disabled = true;
    setStatus(t('action_change_choose_action'));
  }));
  confirm.addEventListener('click', () => void withBusy(confirm, async () => {
    if (!commandId || !previewHash) return;
    const result = await api.call('assistant', { action: 'command', stage: 'confirm', resource: 'actions', commandId, previewHash });
    if (!active() || !result?.ok) throw new Error('CONFIRM_FAILED');
    confirm.disabled = true; execute.disabled = false;
  }));
  execute.addEventListener('click', () => void withBusy(execute, async () => {
    if (!commandId || !previewHash) return;
    const result = await api.call('assistant', { action: 'command', stage: 'execute', resource: 'actions', commandId });
    if (!active() || !result?.ok) throw new Error('EXECUTE_FAILED');
    completed = true; plan.disabled = review.disabled = confirm.disabled = execute.disabled = interpret.disabled = true;
    setStatus(t('action_change_success'));
  }));
}
