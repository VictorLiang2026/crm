// PC18：活动复盘版本、人工候选审核与 Outcome；所有写入须经服务端预览。
import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { bdg, emptyNote, sectionTitle } from './ui.js';

const ACTION_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const OPPORTUNITY_TYPES = ['insurance', 'recruit', 'referral', 'activity', 'speaker', 'partnership', 'service', 'relationship'];
const nonce = () => window.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
  c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3 | 8)).toString(16); });

function field(label, control) {
  return h('div', { class: 'sheet-field' }, [h('label', {}, label), control]);
}
function input(value, type = 'text', maxLength = '200') {
  const node = h('input', { class: 'sheet-input', type, maxlength: maxLength });
  node.value = value == null ? '' : String(value);
  return node;
}
function textarea(value, maxLength = '4000') {
  const node = h('textarea', { class: 'sheet-input', rows: '3', maxlength: maxLength });
  node.value = value == null ? '' : String(value);
  return node;
}
function select(options, current) {
  const node = h('select', { class: 'sheet-select' }, options.map(([value, label]) =>
    h('option', { value, ...(String(value) === String(current) ? { selected: true } : {}) }, label)));
  node.value = String(current ?? '');
  return node;
}
function itemList(items) {
  if (!Array.isArray(items) || !items.length) return emptyNote(t('pc18_no_supported_evidence'), '');
  return h('ul', { class: 'summary-list' }, items.map(item => {
    const refs = Array.isArray(item?.sourceRefs) ? item.sourceRefs : [];
    return h('li', {}, [
      h('span', {}, typeof item === 'string' ? item : item?.text || ''),
      refs.length ? h('span', { class: 'foot-note', style: 'display:block;margin-top:3px' },
        `${t('pc18_sources')}: ${refs.join(', ')}`) : null,
    ]);
  }));
}
function formatTime(value) {
  if (!value) return t('pc18_time_unavailable');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
function confidenceText(candidate) {
  const value = candidate?.confidence ?? candidate?.confidenceScore ?? candidate?.score;
  if (value == null || value === '') return t('pc18_confidence_missing');
  return typeof value === 'number' ? `${Math.round(value * (value <= 1 ? 100 : 1))}%` : String(value);
}
function decisionFor(version, kind, index) {
  return (version.decisions || []).find(decision => decision.kind === kind && decision.candidateIndex === index);
}
function resultId(value) { return String(value ?? ''); }

function buildPreview(ctx, activityId, resultIdValue, operation, candidateIndex, draft, host, onDone) {
  host.replaceChildren(h('p', { class: 'sheet-note' }, t('pc18_preview_loading')));
  (async () => {
    try {
      const response = await data.previewActivityReview(ctx, {
        idempotencyKey: nonce(), operation, activityId: Number(activityId),
        ...(operation === 'outcome' ? {} : { resultId: Number(resultIdValue), candidateIndex }), draft,
      });
      const preview = response.preview || response;
      if (!preview.previewId) throw new Error(t('pc18_preview_invalid'));
      const rows = [
        h('div', { class: 'sheet-preview' }, [
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('pc18_review_person')),
            h('span', {}, preview.personName ? `${preview.personName} · #${preview.personId}` : t('pc18_activity_scope'))]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('pc18_preview_after')),
            h('span', {}, JSON.stringify(preview.after || draft))]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('pc18_sources')),
            h('span', {}, (preview.sourceRefs || []).join(', ') || t('pc18_no_source'))]),
          preview.expiresAt ? h('div', { class: 'sheet-note' }, `${t('pc18_preview_expires')}: ${formatTime(preview.expiresAt)}`) : null,
          preview.replayed ? h('div', { class: 'sheet-note' }, t('pc18_replayed')) : null,
          h('div', { class: 'sheet-note' }, t('pc18_preview_guard')),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => host.replaceChildren() }, t('btn_cancel')),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = t('writing');
            try {
              const executed = await data.executeActivityReview(ctx, preview.previewId);
              host.replaceChildren(h('p', { class: 'sheet-note' }, resultSummary(executed)));
              onDone?.();
            } catch (error) {
              button.disabled = false;
              button.textContent = t('confirm_write');
              host.append(h('p', { class: 'form-msg error' }, `${t('pc18_execute_failed')}: ${error.message}`));
            }
          } }, t('confirm_write')),
        ]),
      ];
      host.replaceChildren(...rows);
    } catch (error) {
      host.replaceChildren(h('p', { class: 'form-msg error' }, `${t('pc18_preview_failed')}: ${error.message}`));
    }
  })();
}
function resultSummary(result) {
  if (!result || typeof result !== 'object') return t('pc18_execution_done');
  const id = result.actionId || result.candidateId || result.outcomeId;
  return `${result.replayed ? t('pc18_replayed') : t('pc18_execution_done')}${id ? ` · ${t('pc18_business_id')} #${id}` : ''}`;
}

function candidateCard(ctx, activityId, version, kind, candidate, index, refresh) {
  const sourceIndex = Number.isSafeInteger(candidate?.sourceIndex) && candidate.sourceIndex >= 0
    ? candidate.sourceIndex : index;
  const decision = decisionFor(version, kind, sourceIndex);
  const status = decision ? decision.status : 'pending';
  const operation = kind === 'action' ? 'action' : 'opportunity';
  const editor = h('div', {});
  const person = candidate.personName
    ? h('a', { href: `#/person/${candidate.personId}` }, `${candidate.personName} · #${candidate.personId}`)
    : `${t('pc18_person_fallback')} #${candidate.personId || '—'}`;
  const details = [
    h('div', { class: 'stack-head' }, [
      h('div', { class: 'row-title' }, [person, bdg(t(`pc18_status_${status}`), status === 'accepted' ? 'jade' : status === 'rejected' ? 'gray' : 'gold')]),
      h('span', { class: 'row-sub' }, `${t('pc18_confidence')}: ${confidenceText(candidate)}`),
    ]),
    kind === 'action' ? h('div', { class: 'row-sub' }, candidate.title || '') : h('div', { class: 'row-sub' },
      `${translateEnum('opportunity_type', candidate.opportunityType) || candidate.opportunityType || ''}`),
    candidate.reason ? h('p', { class: 'summary-text' }, candidate.reason) : null,
    kind === 'opportunity' && candidate.nextAction ? h('p', { class: 'row-sub' }, `${t('pc18_next_action')}: ${candidate.nextAction}`) : null,
    h('div', { class: 'foot-note' }, `${t('pc18_sources')}: ${(candidate.sourceRefs || []).join(', ') || t('pc18_no_source')}`),
    decision?.result?.actionId || decision?.result?.candidateId
      ? h('div', { class: 'foot-note' }, `${t('pc18_business_id')}: #${decision.result.actionId || decision.result.candidateId}`) : null,
  ];
  const actions = [];
  if (!decision) {
    const editButton = h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => {
      const error = h('p', { class: 'form-msg error' });
      let draft;
      let fields;
      if (kind === 'action') {
        const title = input(candidate.title || '', 'text', '200');
        const description = textarea(candidate.description || candidate.reason || '', '4000');
        const due = input('', 'datetime-local', '');
        const priority = select(ACTION_PRIORITIES.map(value => [value, t(`priority_${value}`)]), 'medium');
        fields = [field(t('field_title'), title), field(t('field_description'), description),
          field(t('field_due'), due), field(t('field_priority'), priority)];
        draft = () => ({ title: title.value.trim(), description: description.value,
          dueAt: due.value ? new Date(due.value).toISOString() : null, priority: priority.value });
      } else {
        const type = select(OPPORTUNITY_TYPES.map(value => [value, translateEnum('opportunity_type', value) || value]), candidate.opportunityType);
        const reason = textarea(candidate.reason || '', '1000');
        const nextAction = textarea(candidate.nextAction || '', '500');
        fields = [field(t('pc18_opportunity_type'), type), field(t('pc18_reason'), reason), field(t('pc18_next_action'), nextAction)];
        draft = () => ({ type: type.value, reason: reason.value.trim(), nextAction: nextAction.value.trim() });
      }
      const previewHost = h('div', {});
      const previewButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => {
        try {
          const payload = draft();
          if (!payload.title && kind === 'action') throw new Error(t('pc18_title_required'));
          if (kind === 'opportunity' && (!payload.reason || !payload.nextAction)) throw new Error(t('pc18_fields_required'));
          buildPreview(ctx, activityId, version.id, operation, sourceIndex, payload, previewHost, refresh);
        } catch (e) { error.textContent = e.message; }
      } }, t('pc18_preview_candidate'));
      const rejectButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
        buildPreview(ctx, activityId, version.id, kind === 'action' ? 'reject_action' : 'reject_opportunity',
          sourceIndex, {}, previewHost, refresh);
      } }, t('pc18_reject_candidate'));
      const pendingButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => editor.replaceChildren() }, t('pc18_keep_pending'));
      editor.replaceChildren(h('div', { class: 'card-body' }, [...fields,
        h('div', { class: 'sheet-actions' }, [previewButton, rejectButton, pendingButton]), error, previewHost]));
    } }, t('btn_edit'));
    actions.push(editButton, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => editor.replaceChildren() }, t('pc18_keep_pending')));
  } else if (decision.result?.outcomeId) {
    actions.push(h('span', { class: 'foot-note' }, `${t('pc18_outcome_id')}: #${decision.result.outcomeId}`));
  }
  return h('article', { class: 'list-row pc18-candidate' }, [h('div', { style: 'flex:1;min-width:0' }, [
    ...details,
    h('div', { class: 'sheet-actions', style: 'justify-content:flex-start;margin-top:8px' }, actions),
    editor,
  ])]);
}

function reviewVersion(ctx, activityId, version, refresh) {
  const review = version.review || {};
  const sections = [
    ['act_who_mattered', review.whoMattered], ['act_what_changed', review.whatChanged],
    ['act_relationships_improved', review.relationshipsImproved], ['act_signals_appeared', review.signalsAppeared],
    ['act_opps_appeared', review.opportunitiesAppeared], ['act_followup_people', review.followUpPeople],
  ];
  const body = [
    h('div', { class: 'pc18-version-meta' }, [
      h('b', {}, `${t('pc18_version')} · #${version.id}`),
      h('span', { class: 'row-sub' }, `${t('pc18_generated_at')}: ${formatTime(version.createdAt)}`),
      h('span', { class: 'row-sub' }, `${t('pc18_task_id')}: #${version.taskId}`),
    ]),
    sectionTitle(t('act_review_summary')), h('p', { class: 'summary-text' }, version.summary || t('pc18_summary_missing')),
  ];
  sections.forEach(([key, items]) => body.push(sectionTitle(t(key)), itemList(items)));
  for (const [key, kind, candidates] of [
    ['act_action_candidates', 'action', version.actionCandidates],
    ['act_opp_candidates', 'opportunity', version.opportunityCandidates],
  ]) {
    body.push(sectionTitle(t(key)));
    if (!candidates?.length) body.push(emptyNote(t('pc18_no_supported_evidence'), t('pc18_no_candidate_write')));
    else candidates.forEach((candidate, index) => body.push(candidateCard(ctx, activityId, version, kind, candidate, index, refresh)));
  }
  return h('div', { class: 'tab-stack pc18-version' }, body);
}

function outcomeEditor(ctx, activityId, refresh) {
  const type = input('', 'text', '64');
  type.placeholder = t('pc18_outcome_type_placeholder');
  const result = textarea('', '4000');
  const occurredAt = input(new Date().toISOString().slice(0, 16), 'datetime-local', '');
  const host = h('div', {});
  const error = h('p', { class: 'form-msg error' });
  const preview = h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => {
    error.textContent = '';
    if (!result.value.trim()) { error.textContent = t('pc18_outcome_required'); return; }
    buildPreview(ctx, activityId, null, 'outcome', null, {
      outcomeType: type.value.trim(), result: result.value.trim(),
      occurredAt: occurredAt.value ? new Date(occurredAt.value).toISOString() : null,
    }, host, refresh);
  } }, t('pc18_preview_outcome'));
  return h('section', { class: 'card pc18-outcome-editor' }, [h('div', { class: 'card-body' }, [
    h('p', { class: 'sheet-note' }, t('pc18_outcome_manual_note')),
    field(t('pc18_outcome_type'), type), field(t('pc18_outcome_result'), result), field(t('pc18_occurred_at'), occurredAt),
    h('div', { class: 'sheet-actions' }, [preview]), error, host,
  ])]);
}

export async function renderActivityReview(ctx, activityId) {
  const root = h('div', { class: 'tab-stack pc18-review' });
  const message = h('p', { class: 'sheet-note' }, t('pc18_workflow_note'));
  const generate = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('pc18_generate_review'));
  const status = h('p', { class: 'form-msg' });
  const versionList = h('div', { class: 'pc18-version-list' });
  const versionView = h('div', { class: 'pc18-version-view' });
  const outcomeList = h('div', { class: 'pc18-outcome-list' });
  let history = null;
  let selected = '';
  async function refresh() {
    versionList.replaceChildren(h('p', { class: 'sheet-note' }, t('loading')));
    try {
      history = await data.activityReviewHistory(ctx, activityId);
      const versions = history.versions || [];
      if (!selected || !versions.some(version => resultId(version.id) === selected)) selected = resultId(versions[0]?.id);
      versionList.replaceChildren(...(versions.length ? versions.map(version => h('button', {
        class: `btn btn-ghost btn-sm pc18-version-button${resultId(version.id) === selected ? ' active' : ''}`,
        type: 'button', onclick: () => { selected = resultId(version.id); renderVersions(); },
      }, `${formatTime(version.createdAt)} · #${version.id}`)) : [emptyNote(t('pc18_history_empty'), t('pc18_generate_first'))]));
      renderVersions();
      const outcomes = history.outcomes || [];
      outcomeList.replaceChildren(...(outcomes.length ? outcomes.map(row => h('article', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, `${row.outcome_type || t('pc18_outcome')} · ${formatTime(row.occurred_at)}`),
          h('p', { class: 'summary-text' }, row.result || ''), h('span', { class: 'foot-note' }, `${t('pc18_business_id')}: #${row.id}`),
        ]),
      ])) : [emptyNote(t('pc18_outcome_empty'), '')]));
      if (history.testData?.status === 'unverified') status.textContent = t('pc18_test_data_unverified');
      else if (history.testData?.containsTestData) status.textContent = t('pc18_test_data_notice');
      else status.textContent = '';
    } catch (error) {
      versionList.replaceChildren(emptyNote(t('data_load_failed'), error.message || t('try_later')));
      status.textContent = error.message || t('pc18_history_failed');
    }
  }
  function renderVersions() {
    const version = (history?.versions || []).find(row => resultId(row.id) === selected);
    versionView.replaceChildren(version ? reviewVersion(ctx, activityId, version, refresh) :
      emptyNote(t('pc18_history_empty'), t('pc18_generate_first')));
    versionList.querySelectorAll('.pc18-version-button').forEach(button => button.classList.toggle('active', button.textContent.endsWith(`#${selected}`)));
  }
  generate.onclick = async () => {
    generate.disabled = true;
    status.textContent = t('pc18_generating');
    try {
      const response = await data.activityPostReviewV2(ctx, activityId);
      if (response.error) throw new Error(response.message || response.error);
      selected = resultId(response.result_id || response.ai_result_id || '');
      status.textContent = t('pc18_generated');
      await refresh();
    } catch (error) {
      status.textContent = `${t('act_review_failed')}: ${error.message}`;
    } finally { generate.disabled = false; }
  };
  root.append(message, h('div', { class: 'stack-head' }, [sectionTitle(t('pc18_history_title')), generate]), status,
    h('div', { class: 'pc18-review-layout' }, [versionList, versionView]),
    sectionTitle(t('pc18_outcomes_title')), outcomeList, outcomeEditor(ctx, activityId, refresh));
  await refresh();
  return root;
}
