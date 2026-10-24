import { createApi } from '../../core/api.js';
import { t } from './i18n.js';
import { createHistoryFilters, historyTaskLabel, historyTypeLabel } from './ai-history-filters.js';

const PAGE = '#/ai/experience';
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
};
const message = (host, key, error = false) => {
  host.textContent = t(key);
  host.className = error ? 'crm-ai-exp-error' : 'crm-ai-exp-notice';
};
function addCss() {
  if (document.getElementById('crm-ai-experience-css')) return;
  const link = document.createElement('link');
  link.id = 'crm-ai-experience-css'; link.rel = 'stylesheet';
  link.href = '/crm/css/ai-experience.css'; document.head.append(link);
}
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('crypto.randomUUID is required for an idempotent save');
}
function safeJson(value) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch (_) { return '{}'; }
}
function resultPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* The unchanged original remains available below. */ }
  }
  return {};
}
function taskName(task) {
  const keys = {
    activity_review: 'ai_experience_task_activity_review',
    assistant_opportunity_update_v1: 'ai_experience_task_opportunity_update',
  };
  return Object.hasOwn(keys, task.task_type) ? t(keys[task.task_type]) : (historyTaskLabel(task.task_type) || t('ai_experience_empty'));
}
function taskSubject(task) {
  if (!task.subject_type || !task.subject_id) return t('ai_experience_unbound_subject');
  return `${task.subject_type} #${task.subject_id}`;
}
function appendSources(host, refs) {
  if (!Array.isArray(refs)) return;
  const values = refs.filter(value => typeof value === 'string' && value.trim());
  if (values.length) host.append(el('p', 'crm-ai-exp-evidence', `${t('ai_experience_sources_label')}: ${values.join(' · ')}`));
}
function appendActivitySection(host, key, entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const section = el('section', 'crm-ai-exp-readable-section');
  section.append(el('h4', '', t(key)));
  for (const item of entries) {
    const card = el('div', 'crm-ai-exp-readable-card');
    if (typeof item === 'string') card.append(el('p', '', item));
    else if (item && typeof item === 'object') {
      if (typeof item.title === 'string' && item.title.trim()) card.append(el('strong', '', item.title));
      for (const field of ['text','reason']) {
        if (typeof item[field] === 'string' && item[field].trim()) card.append(el('p', '', item[field]));
      }
      if (item.personId != null) card.append(el('p', 'crm-ai-exp-muted', `${t('ai_experience_person_label')} #${item.personId}`));
      if (typeof item.nextAction === 'string' && item.nextAction.trim()) {
        card.append(el('p', '', `${t('ai_experience_next_action_label')}: ${item.nextAction}`));
      }
      appendSources(card, item.sourceRefs);
    }
    if (card.childNodes.length) section.append(card);
  }
  if (section.childNodes.length > 1) host.append(section);
}
function readableResult(result, task) {
  const original = result.final_result_json || result.result_json;
  const payload = resultPayload(original);
  const readable = el('div', 'crm-ai-exp-readable');
  if (payload.status === 'unsupported' || payload.operation === 'unsupported') {
    readable.append(el('strong', 'crm-ai-exp-unsupported', t('ai_experience_unsupported')));
    if (typeof payload.interpretation === 'string' && payload.interpretation.trim()) {
      readable.append(el('p', '', payload.interpretation));
    }
    readable.append(el('p', 'crm-ai-exp-muted', t('ai_experience_unsupported_no_action')));
  } else if (task.task_type === 'activity_review') {
    if (typeof payload.summary === 'string' && payload.summary.trim()) {
      readable.append(el('p', 'crm-ai-exp-summary', payload.summary));
    }
    for (const [field,key] of [
      ['whatChanged','ai_experience_what_changed'],
      ['whoMattered','ai_experience_who_mattered'],
      ['followUpPeople','ai_experience_followup_people'],
      ['signalsAppeared','ai_experience_signals'],
      ['actionCandidates','ai_experience_action_candidates'],
      ['opportunitiesAppeared','ai_experience_opportunities'],
      ['opportunityCandidates','ai_experience_opportunity_candidates'],
      ['relationshipsImproved','ai_experience_relationships'],
    ]) appendActivitySection(readable, key, payload[field]);
  } else {
    for (const field of ['summary','interpretation','nextStep','brief30Seconds','suggestedObjective','nextObjective']) {
      if (typeof payload[field] === 'string' && payload[field].trim()) readable.append(el('p', '', payload[field]));
    }
  }
  if (!readable.childNodes.length) readable.append(el('p', 'crm-ai-exp-muted', t('ai_experience_raw_hint')));
  const raw = el('details', 'crm-ai-exp-raw');
  raw.append(el('summary', '', t('ai_experience_raw_details')),
    el('pre', 'crm-ai-exp-output', safeJson(original)));
  const container = el('div', 'crm-ai-exp-result-content');
  container.append(readable, raw);
  return container;
}
function inputField(labelKey, { tag = 'input', type = 'text', required = false, maxLength, rows = 3 } = {}) {
  const label = el('label', 'crm-ai-exp-field');
  label.append(el('span', '', t(labelKey)));
  const input = document.createElement(tag);
  if (tag === 'input') input.type = type;
  if (required) input.required = true;
  if (maxLength) input.maxLength = maxLength;
  if (tag === 'textarea') input.rows = rows;
  label.append(input);
  return { label, input };
}
function validResponse(value) {
  if (!value || value.error || value.ok !== true) throw new Error('request');
  return value;
}

export function renderAiExperience({ root, callFn }) {
  addCss();
  const api = createApi(callFn);
  const page = el('section', 'crm-ai-exp-page');
  const back = el('a', 'crm-ai-exp-back', `← ${t('nav_ai')}`); back.href = '#/ai';
  page.append(back, el('h2', '', t('ai_experience_title')), el('p', 'crm-ai-exp-intro', t('ai_experience_intro')));
  const status = el('p', 'crm-ai-exp-notice'); status.setAttribute('aria-live', 'polite');
  const metrics = el('section', 'crm-ai-exp-metrics');
  const workspace = el('div', 'crm-ai-exp-workspace');
  const listPanel = el('section', 'crm-ai-exp-list-panel');
  const listTitle = el('h3', '', t('ai_experience_history'));
  const list = el('div', 'crm-ai-exp-results');
  const detail = el('section', 'crm-ai-exp-detail');
  const outcomeSection = el('section', 'crm-ai-exp-section');
  const learningSection = el('section', 'crm-ai-exp-section');
  listPanel.append(listTitle, list); workspace.append(listPanel, detail);
  const lower = el('div', 'crm-ai-exp-lower'); lower.append(outcomeSection, learningSection);
  const refresh = el('button', 'btn', t('ai_experience_retry')); refresh.type = 'button';
  const outcomeTargets = { actions: [], opportunities: [], activities: [], recruitFollowups: [] };
  let model = { tasks: [], results: [], decisions: [], outcomes: [], learnings: [], metrics: null };
  let selectedResultId = '';
  const learningSelection = new Set();
  const decisionKeys = new Map();
  let activeFilters = {source:'runtime',page:1,limit:20};
  let loading = false, saving = false, loadVersion = 0;
  const filters = createHistoryFilters({api,onApply:next=>void reload({next}),
    onError:key=>message(status,key,true)});
  const pager = el('div','crm-ai-history-pager'); listPanel.append(pager);

  function paginationView() {
    pager.replaceChildren();
    const p = model.pagination;
    const scope=[t(`ai_history_source_${model.source}`),historyTypeLabel(model.source,activeFilters.type),
      activeFilters.personId?`${t('ai_history_scope_person')} #${activeFilters.personId}`:t('ai_history_all_people'),
      activeFilters.startDate||activeFilters.endDate?`${activeFilters.startDate||'…'} → ${activeFilters.endDate||'…'}`:t('ai_history_all_dates')];
    pager.append(el('p','crm-ai-exp-muted',`${t('ai_history_current_scope')}: ${scope.join(' · ')}`));
    pager.append(el('p','crm-ai-exp-muted',t(model.source==='legacy'?'ai_history_legacy_scope':'ai_history_runtime_scope')));
    if (!p) { pager.append(el('p','crm-ai-exp-muted',t('ai_history_recent_only'))); return; }
    const count = model.source==='legacy' ? model.legacy.length : model.tasks.length;
    pager.append(el('p','crm-ai-exp-muted',t('ai_history_page_info').replace('{page}',String(p.page)).replace('{count}',String(count))));
    const previous=el('button','btn',t('file_import_previous'));previous.type='button';previous.disabled=p.page<=1;
    const next=el('button','btn',t('file_import_next'));next.type='button';next.disabled=!p.hasMore;
    previous.addEventListener('click',()=>void reload({next:{...activeFilters,page:p.page-1}}));
    next.addEventListener('click',()=>void reload({next:{...activeFilters,page:p.page+1}}));
    pager.append(previous,next);
    if(Object.values(p.relatedTruncated||{}).some(Boolean))pager.append(el('p','crm-ai-exp-error',t('ai_history_related_limit')));
  }

  function legacyRows() {
    list.replaceChildren();
    if(!model.legacy.length)list.append(el('p','crm-ai-exp-muted',t('ai_experience_no_records')));
    for(const row of model.legacy){
      const article=el('article',`crm-ai-exp-result${String(row.id)===selectedResultId?' is-selected':''}`);
      const pick=el('button','crm-ai-exp-result-pick',`${t('ai_history_source_legacy')} #${row.id}`);pick.type='button';
      pick.addEventListener('click',()=>{selectedResultId=String(row.id);legacyRows();detailView();});
      article.append(pick,el('span','crm-ai-exp-state',t('ai_history_read_only')),
        el('span','crm-ai-exp-muted',`${row.customer_name || t('ai_experience_empty')} · ${row.recommendation_date || ''}`));list.append(article);
    }
  }
  function legacyDetail() {
    const row=model.legacy.find(item=>String(item.id)===selectedResultId);
    if(!row){detail.append(el('p','crm-ai-exp-muted',t('ai_experience_no_selection')));return;}
    detail.append(el('h3','',`${t('ai_history_source_legacy')} #${row.id}`),el('p','crm-ai-exp-current',t('ai_history_readonly_note')),
      el('p','crm-ai-exp-muted',`${t('ai_history_snapshot_name')}: ${row.customer_name || t('ai_experience_empty')}`));
    for(const [key,value]of [['ai_history_recommended_on',row.recommendation_date],['ai_history_followup_on',row.suggested_followup_date],
      ['ai_history_message',row.suggested_message],['ai_history_strategy',row.suggested_strategy]]){
      if(value)detail.append(el('h4','',t(key)),el('p','crm-ai-exp-legacy-copy',value));
    }
    detail.append(el('p','crm-ai-exp-muted',`public.ai_recommendations #${row.id}`));
    const raw=el('details','crm-ai-exp-raw');raw.append(el('summary','',t('ai_experience_raw_details')),el('pre','crm-ai-exp-output',safeJson(row)));detail.append(raw);
    const old=el('a','btn',t('ai_history_legacy_tools'));old.href='/crm/admin.html#/ai-suggestions';detail.append(old);
  }

  function taskFor(result) { return model.tasks.find(task => String(task.id) === String(result.task_id)); }
  function latestDecision(resultId) {
    const event = model.decisions.find(item => String(item.ai_result_id) === String(resultId));
    if (event) return event;
    const result = model.results.find(item => String(item.id) === String(resultId));
    const legacy = typeof result?.feedback === 'string' && result.feedback.startsWith('PC20:')
      ? result.feedback.slice(5) : null;
    const decision = ['accepted','modified','rejected'].includes(legacy) ? legacy :
      result?.user_selected === true ? (result.user_edited === true ? 'modified' : 'accepted') : null;
    return decision ? { decision, legacy:true } : null;
  }
  function learningFor(resultId) {
    return model.learnings.filter(item => String(item.source_id) === String(resultId));
  }
  function metricsView() {
    metrics.replaceChildren();
    if(model.source==='legacy') {metrics.append(el('p','crm-ai-exp-muted',t('ai_history_readonly_note')),refresh);return;}
    const value = model.metrics || {};
    const numerator = Number(value.numerator || 0), denominator = Number(value.denominator || 0);
    metrics.append(el('h3', '', t('ai_experience_metrics')),
      el('strong', 'crm-ai-exp-rate', denominator ? `${Math.round(numerator * 100 / denominator)}%` : t('ai_experience_empty')),
      el('span', '', `${t('ai_experience_numerator')}: ${numerator} / ${denominator}`),
      el('span', '', `${t('ai_experience_pending')}: ${Number(value.pending || 0)}`),
      el('p', 'crm-ai-exp-muted', t('ai_experience_window')));
    metrics.append(el('p','crm-ai-exp-muted',t('ai_history_metrics_scope')),refresh);
  }
  function resultRows() {
    if(model.source==='legacy'){legacyRows();return;}
    list.replaceChildren();
    if (!model.results.length) { list.append(el('p', 'crm-ai-exp-muted', t('ai_experience_no_records'))); return; }
    for (const result of model.results) {
      const task = taskFor(result) || {};
      const row = el('article', `crm-ai-exp-result${String(result.id) === selectedResultId ? ' is-selected' : ''}`);
      const pick = el('button', 'crm-ai-exp-result-pick', `${t('ai_experience_select')} #${result.id}`);
      pick.type = 'button'; pick.addEventListener('click', () => { selectedResultId = String(result.id); resultRows(); detailView(); });
      const checkLabel = el('label', 'crm-ai-exp-check');
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = learningSelection.has(String(result.id));
      check.addEventListener('change', () => {
        if (check.checked) learningSelection.add(String(result.id)); else learningSelection.delete(String(result.id));
        renderLearning();
      });
      checkLabel.append(check, el('span', '', t('ai_experience_selected')));
      const decision = latestDecision(result.id);
      row.append(pick, el('span', 'crm-ai-exp-state', `${t(decision ? `ai_experience_${decision.decision}` : 'ai_experience_pending_value')}${decision?.legacy ? ` · ${t('ai_experience_legacy')}` : ''}`),
        el('span', 'crm-ai-exp-muted', `${t('ai_experience_task')}: ${taskName(task)} · ${task.created_at ? new Date(task.created_at).toLocaleDateString() : t('ai_experience_empty')}`), checkLabel);
      list.append(row);
    }
  }
  function detailView() {
    detail.replaceChildren();
    if(model.source==='legacy'){legacyDetail();return;}
    const result = model.results.find(item => String(item.id) === selectedResultId);
    if (!result) { detail.append(el('p', 'crm-ai-exp-muted', t('ai_experience_no_selection'))); return; }
    const task = taskFor(result) || {};
    detail.append(el('h3', '', `${t('ai_experience_result_detail')} #${result.id}`),
      el('p', 'crm-ai-exp-muted', `${t('ai_experience_task')}: ${taskName(task)} · ${taskSubject(task)}`));
    detail.append(readableResult(result, task));
    detail.append(el('p','crm-ai-exp-muted',t('ai_history_execution_unknown')));
    const current = latestDecision(result.id);
    detail.append(el('p', 'crm-ai-exp-current', `${t('ai_experience_current_decision')}: ${t(current ? `ai_experience_${current.decision}` : 'ai_experience_pending_value')}${current?.created_at ? ` · ${new Date(current.created_at).toLocaleString()}` : ''}`));
    if (typeof current?.reason === 'string' && current.reason.trim()) detail.append(el('p', 'crm-ai-exp-muted', current.reason));
    const decision = el('form', 'crm-ai-exp-form');
    const decisionLabel = el('label', 'crm-ai-exp-field'); decisionLabel.append(el('span', '', t('ai_experience_decision')));
    const decisionSelect = document.createElement('select');
    for (const value of ['pending','accepted','modified','rejected']) decisionSelect.add(new Option(t(`ai_experience_${value === 'pending' ? 'pending_value' : value}`), value));
    decisionSelect.value = latestDecision(result.id)?.decision || 'pending'; decisionLabel.append(decisionSelect);
    const reason = inputField('ai_experience_reason', { tag:'textarea', maxLength:2000, rows:2 });
    const delta = inputField('ai_experience_edit_delta', { tag:'textarea', maxLength:12000, rows:4 });
    reason.label.hidden = !['modified','rejected'].includes(decisionSelect.value);
    reason.input.required = decisionSelect.value === 'rejected';
    delta.label.hidden = decisionSelect.value !== 'modified';
    delta.input.required = decisionSelect.value === 'modified';
    decisionSelect.addEventListener('change', () => {
      reason.label.hidden = !['modified','rejected'].includes(decisionSelect.value);
      reason.input.required = decisionSelect.value === 'rejected';
      delta.label.hidden = decisionSelect.value !== 'modified';
      delta.input.required = decisionSelect.value === 'modified';
    });
    const save = el('button', 'btn btn-primary', t('ai_experience_save_decision')); save.type = 'submit';
    decision.append(decisionLabel, reason.label, delta.label, save);
    decision.addEventListener('submit', event => {
      event.preventDefault();
      let editDelta = null;
      if (decisionSelect.value === 'modified') {
        try {
          editDelta = JSON.parse(delta.input.value);
          if (!editDelta || typeof editDelta !== 'object' || Array.isArray(editDelta) || !Object.keys(editDelta).length) throw new Error('invalid');
        } catch (_) {
          message(status, 'ai_experience_json_invalid', true);
          delta.input.focus();
          return;
        }
      }
      const reasonText = reason.input.value.trim() || null;
      const requestKey = JSON.stringify([result.id, decisionSelect.value, reasonText, editDelta]);
      if (!decisionKeys.has(requestKey)) decisionKeys.set(requestKey, uuid());
      const eventId = decisionKeys.get(requestKey);
      void work(save, async () => {
        const response = validResponse(await api.call('assistant', { action:'aiExperience', operation:'decide',
          eventId, aiResultId:result.id, decision:decisionSelect.value,
          reason:reasonText, editDelta }));
        await showSaved('ai_experience_decision_saved', response.eventId || eventId);
      });
    });
    detail.append(decision);
    const linkedOutcomes = model.outcomes.filter(item => String(item.ai_result_id) === String(result.id));
    const outcomes = el('section', 'crm-ai-exp-linked'); outcomes.append(el('h4', '', t('ai_experience_outcomes')));
    if (!linkedOutcomes.length) outcomes.append(el('p', 'crm-ai-exp-muted', t('ai_experience_empty')));
    for (const row of linkedOutcomes) outcomes.append(el('p', '', `${new Date(row.occurred_at).toLocaleString()}: ${row.result} · ${row.evidence || ''}`));
    const candidates = learningFor(result.id);
    for (const candidate of candidates) outcomes.append(candidateRow(candidate));
    detail.append(outcomes);
  }
  function candidateRow(candidate) {
    const box = el('article', 'crm-ai-exp-candidate');
    box.append(el('strong', '', candidate.confirmed ? t('ai_experience_confirmed') : t('ai_experience_unconfirmed')),
      el('p', '', candidate.learning), el('p', 'crm-ai-exp-muted', `${candidate.scope} · ${t('ai_experience_denominator')}: ${candidate.sample_size ?? t('ai_experience_empty')}`),
      el('p', 'crm-ai-exp-muted', `${t('ai_experience_counterexamples')}: ${(candidate.counterexamples || []).join(', ') || t('ai_experience_empty')}`),
      el('pre', 'crm-ai-exp-output', safeJson(candidate.provenance)));
    if (!candidate.confirmed) {
      const decision = inputField('ai_experience_learning_review', { required:true, maxLength:4000 });
      const confirm = el('button', 'btn btn-primary', t('ai_experience_confirm_learning')); confirm.type = 'button';
      confirm.addEventListener('click', () => void work(confirm, async () => {
        const response = validResponse(await api.call('assistant', { action:'aiExperience', operation:'confirmLearning',
          learningId:candidate.id, decision:decision.input.value.trim() }));
        await showSaved('ai_experience_learning_confirmed_receipt', response.learningId || candidate.id);
      }));
      box.append(decision.label, confirm);
    }
    return box;
  }
  async function loadTargets() {
    const response = validResponse(await api.call('assistant', { action:'aiExperience', operation:'targets' }));
    outcomeTargets.actions = response.actions || [];
    outcomeTargets.opportunities = response.opportunities || [];
    outcomeTargets.activities = response.activities || [];
    outcomeTargets.recruitFollowups = response.recruitFollowups || [];
  }
  function renderOutcome() {
    outcomeSection.replaceChildren(el('h3', '', t('ai_experience_actual_outcome')));
    const form = el('form', 'crm-ai-exp-form');
    const typeField = el('label', 'crm-ai-exp-field'); typeField.append(el('span', '', t('ai_experience_work_type')));
    const type = document.createElement('select');
    const typeKeys = [['action','action'],['opportunity','opportunity'],['activity','activity'],['recruit_followup','recruit_followup']];
    for (const [value,key] of typeKeys) type.add(new Option(t(`ai_experience_${key}`), value));
    typeField.append(type);
    const targetField = el('label', 'crm-ai-exp-field'); targetField.append(el('span', '', t('ai_experience_work_item')));
    const target = document.createElement('select'); target.required = true; targetField.append(target);
    function fillTargets() {
      target.replaceChildren(new Option(t('ai_experience_empty'), ''));
      const key = ({ action:'actions', opportunity:'opportunities', activity:'activities', recruit_followup:'recruitFollowups' })[type.value];
      for (const item of outcomeTargets[key] || []) {
        const label = item.title || item.name || item.opportunity_type || `#${item.id}`;
        target.add(new Option(`#${item.id} · ${label}`, String(item.id)));
      }
    }
    type.addEventListener('change', fillTargets); fillTargets();
    const aiLink = el('label', 'crm-ai-exp-field'); aiLink.append(el('span', '', t('ai_experience_link_result')));
    const aiResult = document.createElement('select'); aiResult.add(new Option(t('ai_experience_empty'), ''));
    for (const item of model.results) aiResult.add(new Option(`#${item.id}`, String(item.id)));
    aiResult.value = selectedResultId; aiLink.append(aiResult);
    const actual = inputField('ai_experience_actual_text', { tag:'textarea', required:true, maxLength:4000, rows:3 });
    const occurred = inputField('ai_experience_occurred_at', { type:'datetime-local', required:true });
    const evidence = inputField('ai_experience_evidence', { tag:'textarea', required:true, maxLength:8000, rows:3 });
    const save = el('button', 'btn btn-primary', t('ai_experience_save_outcome')); save.type = 'submit';
    form.append(typeField,targetField,aiLink,actual.label,occurred.label,evidence.label,save);
    form.addEventListener('submit', event => {
      event.preventDefault(); void work(save, async () => {
        const response = validResponse(await api.call('assistant', { action:'aiExperience', operation:'outcome',
          idempotencyKey:uuid(), targetType:type.value, targetId:Number(target.value),
          aiResultId:aiResult.value || null, result:actual.input.value.trim(),
          occurredAt:new Date(occurred.input.value).toISOString(), evidence:evidence.input.value.trim() }));
        await showSaved('ai_experience_outcome_saved', response.outcomeId);
      });
    });
    outcomeSection.append(form);
  }
  function renderLearning() {
    learningSection.replaceChildren(el('h3', '', t('ai_experience_learning_candidate')),
      el('p', 'crm-ai-exp-muted', t('ai_experience_candidate_provenance')));
    const form = el('form', 'crm-ai-exp-form');
    const selected = [...learningSelection];
    const sources = inputField('ai_experience_sources'); sources.input.value = selected.join(','); sources.input.readOnly = true;
    const primary = el('label', 'crm-ai-exp-field'); primary.append(el('span', '', t('ai_experience_primary_source')));
    const primarySelect = document.createElement('select');
    for (const value of selected) primarySelect.add(new Option(`#${value}`, value));
    primary.append(primarySelect);
    const situation = inputField('ai_experience_situation', { tag:'textarea', required:true, maxLength:2000 });
    const recommendation = inputField('ai_experience_recommendation', { tag:'textarea', maxLength:4000 });
    const actualAction = inputField('ai_experience_actual_action', { tag:'textarea', maxLength:4000 });
    const learning = inputField('ai_experience_learning_text', { tag:'textarea', required:true, maxLength:4000 });
    const scope = inputField('ai_experience_scope', { required:true, maxLength:128 });
    const counterexamples = inputField('ai_experience_counterexamples');
    const submit = el('button', 'btn btn-primary', t('ai_experience_prepare_learning')); submit.type = 'submit'; submit.disabled = !selected.length;
    form.append(sources.label,primary,situation.label,recommendation.label,actualAction.label,learning.label,scope.label,counterexamples.label,submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); void work(submit, async () => {
        const ids = [...learningSelection].map(Number);
        const counterIds = counterexamples.input.value.split(',').map(value => value.trim()).filter(Boolean).map(Number);
        const response = validResponse(await api.call('assistant', { action:'aiExperience', operation:'learning', candidateKey:uuid(),
          payload:{ sourceResultIds:ids, primaryResultId:Number(primarySelect.value), situation:situation.input.value.trim(),
            recommendation:recommendation.input.value.trim(), actualAction:actualAction.input.value.trim(),
            learning:learning.input.value.trim(), scope:scope.input.value.trim(), counterexampleIds:counterIds } }));
        learningSelection.clear();
        await showSaved('ai_experience_learning_saved', response.learningId);
      });
    });
    learningSection.append(form);
  }
  async function work(button, action) {
    if (button.disabled || loading || saving || model.source==='legacy' || location.hash !== PAGE) return;
    saving=true; filters.setBusy(true);refresh.disabled=true;
    button.disabled = true;
    try { await action(); }
    catch (_) { message(status, 'ai_experience_save_failed', true); }
    finally { saving=false;filters.setBusy(loading);refresh.disabled=loading;if (location.hash === PAGE) button.disabled = false; }
  }
  async function showSaved(key, receiptId) {
    const refreshed = await reload({ quiet:true });
    if (location.hash !== PAGE) return;
    status.className = refreshed ? 'crm-ai-exp-notice' : 'crm-ai-exp-error';
    status.textContent = `${t(key)}${receiptId != null ? ` ${receiptId}` : ''}${refreshed ? '' : ` · ${t('ai_experience_refresh_after_save_failed')}`}`;
  }
  async function reload({ quiet = false, next = activeFilters } = {}) {
    if (location.hash !== PAGE || (saving&&!quiet)) return false;
    const version=++loadVersion;
    const requested={...next};
    loading=true;filters.setBusy(true);refresh.disabled=true;detail.inert=true;lower.inert=true;pager.inert=true;
    if (!quiet) message(status, 'ai_experience_loading');
    try {
      const [response] = await Promise.all([
        api.call('assistant', { action:'aiExperience', operation:'list', filters:requested }),
        requested.source==='legacy' ? Promise.resolve() : loadTargets(),
      ]);
      validResponse(response);
      if (location.hash !== PAGE || version!==loadVersion) return false;
      if(response.source && response.source!==requested.source)throw Error('source');
      if(requested.source==='legacy'&&!Array.isArray(response.legacy))throw Error('legacy');
      const changed=JSON.stringify(requested)!==JSON.stringify(activeFilters);
      model = {...response,source:response.source||requested.source,legacy:response.legacy||[]};
      activeFilters=requested;
      if(changed) {learningSelection.clear();selectedResultId='';}
      const visible=model.source==='legacy'?model.legacy:model.results;
      if (!visible.some(result => String(result.id) === selectedResultId)) selectedResultId = String(visible[0]?.id || '');
      metricsView(); resultRows(); detailView();paginationView();
      lower.style.display=model.source==='legacy'?'none':'';
      if(model.source==='legacy'){outcomeSection.replaceChildren();learningSection.replaceChildren();}
      else{renderOutcome();renderLearning();}
      if (!quiet) status.textContent = '';
      return true;
    } catch (_) {
      if (!quiet && version===loadVersion) message(status, 'ai_history_load_preserved', true);
      return false;
    } finally {
      if(version===loadVersion){loading=false;filters.setBusy(saving);refresh.disabled=saving;detail.inert=false;lower.inert=false;pager.inert=false;}
    }
  }
  refresh.addEventListener('click', () => void reload());
  root.replaceChildren(page);
  page.append(filters.node, metrics, status, workspace, lower);
  void reload();
}
