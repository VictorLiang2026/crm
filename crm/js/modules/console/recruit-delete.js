// PC28: a single Person-only recruit delete with server impact preview and human confirmation.
import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { getLang, t, translateEnum } from './i18n.js';

const asId = value => String(value ?? '');
const line = (key, value) => h('div', { class: 'kv-line' }, [
  h('span', { class: 'kv-k' }, t(key)), h('span', {}, String(value ?? '-')),
]);

export function openRecruitDeleteCommand(ctx) {
  const query = h('textarea', { class: 'sheet-input', rows: 3, maxlength: 1200,
    'aria-label': t('pc28_query'), placeholder: t('pc28_query_hint') });
  const interpret = h('button', { class: 'btn btn-primary', type: 'button', title: t('pc28_interpret') }, t('pc28_interpret'));
  const people = h('div', { class: 'sheet-stack' });
  const candidates = h('div', { class: 'sheet-stack' });
  const previewNode = h('div', { class: 'sheet-preview' });
  const status = h('p', { class: 'sheet-note', role: 'status', 'aria-live': 'polite' }, t('pc28_intro'));
  const testNotice = h('p', { class: 'sheet-note', role: 'status' });
  const plan = h('button', { class: 'btn btn-ghost', type: 'button' }, t('pc28_plan'));
  const review = h('button', { class: 'btn btn-ghost', type: 'button' }, t('pc28_preview'));
  const confirm = h('button', { class: 'btn btn-ghost', type: 'button' }, t('pc28_confirm'));
  const execute = h('button', { class: 'btn btn-primary', type: 'button' }, t('pc28_execute'));
  const body = h('div', {}, [
    h('label', { class: 'sheet-field' }, [h('span', {}, t('pc28_query')), query]),
    h('div', { class: 'sheet-actions' }, [interpret]), status,
    h('h3', { class: 'sheet-section-title' }, t('pc28_person')), people,
    h('h3', { class: 'sheet-section-title' }, t('pc28_candidate')), candidates,
    testNotice, previewNode,
    h('div', { class: 'sheet-actions' }, [plan, review]),
    h('div', { class: 'sheet-actions' }, [confirm, execute]),
  ]);
  const sheet = openSheet({ title: t('pc28_title'), sub: t('pc28_scope'), body });
  document.body.appendChild(sheet.overlay);

  const state = { busy: false, proposal: null, person: null, candidate: null,
    key: null, commandId: null, previewHash: null, confirmed: false, completed: false };
  function sync() {
    query.disabled = state.busy || state.completed;
    interpret.disabled = state.busy || state.completed || !query.value.trim();
    plan.disabled = state.busy || state.completed || !state.person || !state.candidate || !!state.commandId;
    review.disabled = state.busy || state.completed || !state.commandId || !!state.previewHash;
    confirm.disabled = state.busy || state.completed || !state.previewHash || state.confirmed;
    execute.disabled = state.busy || state.completed || !state.confirmed;
    for (const option of [...people.querySelectorAll('button'), ...candidates.querySelectorAll('button')])
      option.disabled = state.busy || state.completed || !!state.commandId;
  }
  function clearCommand() {
    state.key = state.commandId = state.previewHash = null;
    state.confirmed = false; previewNode.replaceChildren(); sync();
  }
  function clearSelection() {
    state.proposal = state.person = state.candidate = null;
    people.replaceChildren(); candidates.replaceChildren(); testNotice.textContent = '';
    clearCommand();
  }
  function failure(error) {
    const code = String(error?.message || '').split(':')[0];
    const key = code === 'PREVIEW_STALE' ? 'pc28_stale' :
      code === 'COMMAND_DENIED' ? 'pc28_denied' :
      code === 'INVALID_COMMAND' ? 'pc28_invalid' :
      code === 'TIMEOUT' ? 'pc28_timeout' :
      (code === 'AI_RETRY_LATER' || code === 'AI_IN_PROGRESS') ? 'pc28_retry_later' : 'pc28_failed';
    sheet.showErr(t(key));
    status.textContent = t(key);
    if (code === 'PREVIEW_STALE') clearCommand();
  }
  async function work(fn) {
    if (state.busy || state.completed || !sheet.overlay.isConnected) return;
    sheet.swap(body); state.busy = true; sync();
    try { await fn(); } catch (error) { if (sheet.overlay.isConnected) failure(error); }
    finally { state.busy = false; if (sheet.overlay.isConnected) sync(); }
  }

  query.addEventListener('input', () => { clearSelection(); status.textContent = t('pc28_intro'); sync(); });
  interpret.addEventListener('click', () => work(async () => {
    clearSelection(); status.textContent = t('pc28_working');
    const response = await data.recruitDeleteInterpret(ctx, query.value.trim(), getLang() === 'en' ? 'en' : 'zh-CN');
    if (!response?.ok) throw new Error('INVALID_COMMAND');
    if (response.status === 'unsupported') { status.textContent = t('pc28_unsupported'); return; }
    if (response.status === 'needs_clarification') { status.textContent = t('pc28_clarify'); return; }
    if (response.status === 'person_not_found') { status.textContent = t('pc28_no_person'); return; }
    if (response.status !== 'needs_person_selection' || !Array.isArray(response.candidates))
      throw new Error('INVALID_COMMAND');
    if (response.hasMore) { status.textContent = t('pc28_refine'); return; }
    state.proposal = response.proposal;
    for (const row of response.candidates) {
      const option = h('button', { class: 'btn btn-ghost', type: 'button',
        title: `${row.displayName} #${row.id}` }, `#${row.id} · ${row.displayName}`);
      option.addEventListener('click', () => work(async () => {
        clearCommand(); state.person = state.candidate = null; candidates.replaceChildren();
        const targets = await data.recruitDeleteTargets(ctx, state.proposal.personMention, asId(row.id));
        if (!targets?.ok || targets.hasMore || !Array.isArray(targets.candidates))
          throw new Error('INVALID_COMMAND');
        state.person = targets.person;
        for (const other of people.querySelectorAll('button')) other.classList.toggle('selected', other === option);
        testNotice.textContent = targets.testData?.containsTestData ? t('pc28_test_notice') : '';
        if (!targets.candidates.length) { status.textContent = t('pc28_no_candidate'); return; }
        for (const candidate of targets.candidates) {
          const label = `#${candidate.id} · ${translateEnum('recruit_stage', candidate.stage) || t('stage_unknown')}`;
          const button = h('button', { class: 'btn btn-ghost', type: 'button', title: label }, label);
          button.addEventListener('click', () => {
            if (state.busy || state.commandId) return;
            state.candidate = candidate; clearCommand();
            for (const choice of candidates.querySelectorAll('button')) choice.classList.toggle('selected', choice === button);
            status.textContent = t('pc28_selected'); sync();
          });
          candidates.append(button);
        }
        status.textContent = t('pc28_choose_candidate');
      }));
      people.append(option);
    }
    status.textContent = t('pc28_choose_person');
  }));

  plan.addEventListener('click', () => work(async () => {
    if (!state.person || !state.candidate || !state.proposal) return;
    state.key ||= crypto.randomUUID();
    const response = await data.recruitDeleteCommand(ctx, { stage: 'plan', idempotencyKey: state.key,
      command: { resource: 'recruit_candidates', operation: 'delete', personId: asId(state.person.id),
        candidateId: asId(state.candidate.id), personMention: state.proposal.personMention,
        requestText: query.value.trim() } });
    if (!response?.ok || !response.commandId) throw new Error('INVALID_COMMAND');
    state.commandId = response.commandId;
    if (response.status === 'executed') {
      state.completed = true; status.textContent = t('pc28_replayed');
      previewNode.append(line('pc28_batch', response.result?.batchId || '-'),
        h('a', { href: '#/recycle/recruit', class: 'btn btn-ghost', title: t('pc28_restore_link') }, t('pc28_restore_link')));
      return;
    }
    if (response.status === 'confirmed') {
      state.completed = true; status.textContent = t('pc28_prior_confirmed'); return;
    }
    status.textContent = t('pc28_planned');
  }));
  review.addEventListener('click', () => work(async () => {
    if (!state.commandId) return;
    const response = await data.recruitDeleteCommand(ctx, { stage: 'preview', commandId: state.commandId });
    if (!response?.ok || response.status !== 'previewed' || !response.previewHash || !response.preview)
      throw new Error('INVALID_COMMAND');
    state.previewHash = response.previewHash;
    const p = response.preview;
    previewNode.replaceChildren(
      h('h3', { class: 'sheet-section-title' }, t('pc28_impact')),
      line('pc28_person', `${p.personName} #${p.personId}`),
      line('pc28_candidate', `#${p.candidateId} · ${translateEnum('recruit_stage', p.candidateStage) || t('stage_unknown')}`),
      line('pc28_followups', p.followupCount),
      line('pc28_followup_ids', (p.followupIds || []).join(', ') || '-'),
      line('pc28_predeleted', p.alreadyDeletedFollowupCount),
      line('pc28_preserved', t('pc28_preserved_value')),
      line('pc28_expires', new Date(response.expiresAt).toLocaleString()),
      h('p', { class: 'sheet-note' }, t('pc28_confirm_note')),
    );
    status.textContent = t('pc28_preview_ready');
  }));
  confirm.addEventListener('click', () => work(async () => {
    if (!state.commandId || !state.previewHash) return;
    const response = await data.recruitDeleteCommand(ctx, { stage: 'confirm', commandId: state.commandId,
      previewHash: state.previewHash });
    if (!response?.ok || response.status !== 'confirmed') throw new Error('INVALID_COMMAND');
    state.confirmed = true; status.textContent = t('pc28_confirmed');
  }));
  execute.addEventListener('click', () => work(async () => {
    if (!state.commandId || !state.confirmed) return;
    const response = await data.recruitDeleteCommand(ctx, { stage: 'execute', commandId: state.commandId });
    if (!response?.ok || response.status !== 'executed') throw new Error('INVALID_COMMAND');
    state.completed = true; status.textContent = t(response.replayed ? 'pc28_replayed' : 'pc28_done');
    const result = response.result || {};
    previewNode.append(line('pc28_batch', result.batchId || '-'),
      h('a', { href: '#/recycle/recruit', class: 'btn btn-ghost', title: t('pc28_restore_link') }, t('pc28_restore_link')));
    ctx.toast(t('pc28_done'), 'ok');
  }));
  sync();
  return sheet;
}
