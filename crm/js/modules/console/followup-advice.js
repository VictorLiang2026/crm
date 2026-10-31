import { h } from './dom.js';
import { ic } from './icons.js';
import { pageHead, card } from './ui.js';
import { data } from './data.js';
import { t } from './i18n.js';

const text = key => t(`fa_${key}`);
const sourceList = (items = []) => items.length ? h('ul', { class: 'fa-sources' }, items.map(source =>
  h('li', {}, [h('a', { href: `#/knowledge-governance?item=${encodeURIComponent(source.id)}`,
    title: `${source.title || text('knowledge_source')} · ${text('source_id')} ${source.id}` },
    `${source.title || text('knowledge_source')} · ${text('source_id')} ${source.id}`),
    source.sourceDate ? h('small', {}, source.sourceDate) : null]))) : h('p', { class: 'fa-muted' }, text('no_sources'));

function section(titleKey, content, sources) {
  return h('section', { class: 'fa-section' }, [h('h4', {}, text(titleKey)),
    h('p', {}, content || '—'), h('details', {}, [h('summary', {}, text('sources')), sourceList(sources || [])])]);
}

function compareLane(label, advice, variant, statusText = '') {
  const lane = advice?.[variant] || {};
  return h('article', { class: `fa-lane fa-lane-${variant}` }, [
    h('header', { class: 'fa-lane-head' }, [h('h3', {}, label), h('span', { class: `fa-status fa-status-${lane.status || 'pending'}` }, statusText)]),
    section('overall_strategy', lane.strategy, lane.strategySources),
    section('product_service_advice', lane.productAdvice, lane.productSources),
    lane.basedOnSystemVersion ? h('p', { class: 'fa-muted' }, `${text('based_on_version')} ${lane.basedOnSystemVersion}`) : null,
  ]);
}

function editDialog(advice, onClose, onSave) {
  const input = (labelKey, value, area = true) => {
    const control = h(area ? 'textarea' : 'input', area ? { rows: 5, maxlength: 4000 } : { type: 'text', maxlength: 240 });
    control.value = value || '';
    return { control, node: h('label', { class: 'fa-form-field' }, [h('span', {}, text(labelKey)), control]) };
  };
  const title = input('title_label', advice.title, false);
  const systemStrategy = input('system_strategy_label', advice.system.strategy);
  const systemProduct = input('system_product_label', advice.system.productAdvice);
  const gptStrategy = input('gpt_strategy_label', advice.gpt.strategy);
  const gptProduct = input('gpt_product_label', advice.gpt.productAdvice);
  const action = h('select', {}, [
    h('option', { value: 'keep' }, text('keep_gpt')),
    h('option', { value: 'edit' }, text('edit_gpt')),
    h('option', { value: 'delete' }, text('delete_gpt')),
  ]);
  action.value = advice.gpt.strategy ? 'keep' : 'delete';
  const gptFields = h('div', { class: 'fa-gpt-edit-fields' }, [gptStrategy.node, gptProduct.node]);
  action.addEventListener('change', () => { gptFields.hidden = action.value !== 'edit'; });
  gptFields.hidden = action.value !== 'edit';
  const status = h('p', { class: 'fa-form-status', role: 'status' });
  const panel = h('section', { class: 'fa-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fa-edit-title' }, [
    h('header', {}, [h('h2', { id: 'fa-edit-title' }, text('edit_title')),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('close'))]),
    title.node, systemStrategy.node, systemProduct.node,
    h('label', { class: 'fa-form-field' }, [h('span', {}, text('gpt_edit_policy')), action]),
    gptFields, status,
    h('footer', {}, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
        event.currentTarget.disabled = true; status.textContent = text('saving');
        try {
          const gptAction = action.value;
          await onSave({ title: title.control.value, systemStrategy: systemStrategy.control.value,
            systemProductAdvice: systemProduct.control.value, gptAction,
            ...(gptAction === 'edit' ? { gptStrategy: gptStrategy.control.value, gptProductAdvice: gptProduct.control.value } : {}) });
          onClose();
        } catch (_) { status.textContent = text('save_failed'); event.currentTarget.disabled = false; }
      } }, text('save'))]),
  ]);
  return h('div', { class: 'fa-modal-overlay', onclick: event => { if (event.target === event.currentTarget) onClose(); } }, panel);
}

export function renderFollowupAdvice(ctx, personId) {
  const main = ctx.main;
  let rows = [], legacyRows = [], busy = false, modal = null;
  const status = h('p', { class: 'fa-page-status', role: 'status' });
  const listRoot = h('div', { class: 'fa-list' });
  const createForm = h('form', { class: 'fa-create-form', hidden: true });
  const titleInput = h('input', { type: 'text', maxlength: 240, required: true });
  const focusInput = h('textarea', { rows: 3, maxlength: 1200 });
  const createButton = h('button', { class: 'btn btn-primary', type: 'submit' }, [ic('sparkle'), text('generate_system')]);
  createForm.append(h('label', { class: 'fa-form-field' }, [h('span', {}, text('title_label')), titleInput]),
    h('label', { class: 'fa-form-field' }, [h('span', {}, text('focus_label')), focusInput]),
    h('div', { class: 'fa-actions' }, [createButton, h('button', { class: 'btn btn-ghost', type: 'button',
      onclick: () => { createForm.hidden = true; } }, text('cancel'))]));
  createForm.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    busy = true; createButton.disabled = true; status.textContent = text('generating');
    const clientRequestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000`;
    try {
      await data.generateFollowupAdvice(ctx, { personId: String(personId), title: titleInput.value.trim(),
        focus: focusInput.value.trim(), clientRequestId });
      titleInput.value = ''; focusInput.value = ''; createForm.hidden = true;
      await load(); status.textContent = text('generated');
    } catch (_) { status.textContent = text('generate_failed'); }
    finally { busy = false; createButton.disabled = false; }
  });
  async function load() {
    const [current, legacy] = await Promise.all([
      data.followupAdviceList(ctx, personId),
      data.dualFollowupHistory(ctx, personId).catch(() => ({ rows: [] })),
    ]);
    rows = current.rows || []; legacyRows = legacy.rows || []; draw();
  }
  async function edit(row) {
    modal = editDialog(row, () => { modal?.remove(); modal = null; draw(); }, async changes => {
      await data.updateFollowupAdvice(ctx, { id: row.id, personId: String(personId), systemVersion: row.system.version,
        updatedAt: row.updatedAt, ...changes });
      await load();
    });
    draw();
  }
  async function remove(row) {
    if (!window.confirm(text('confirm_delete'))) return;
    try { await data.deleteFollowupAdvice(ctx, { id: row.id, personId: String(personId), updatedAt: row.updatedAt }); await load(); }
    catch (_) { status.textContent = text('save_failed'); }
  }
  function draw() {
    listRoot.replaceChildren(...(rows.length ? rows.map(row => h('article', { class: 'fa-row' }, [
      h('header', { class: 'fa-row-head' }, [h('div', {}, [h('h2', {}, row.title),
        h('p', { class: 'fa-muted' }, `${text('system_version')} ${row.system.version} · ${new Date(row.updatedAt).toLocaleString()}`)]),
        h('div', { class: 'fa-row-actions' }, [
          row.gpt.strategy && row.gpt.status === 'stale' ? h('button', { class: 'btn btn-soft btn-sm', type: 'button',
            onclick: async () => { try { await data.keepGptFollowupAdvice(ctx, { adviceId: row.id, personId: String(personId),
              systemVersion: row.system.version, updatedAt: row.updatedAt }); await load(); } catch (_) { status.textContent = text('save_failed'); } } }, text('keep_gpt')) : null,
          row.system.status === 'ready' ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => edit(row) }, [ic('edit'), text('edit')]) : null,
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => remove(row) }, [ic('trash'), text('delete')]),
        ])]),
      h('div', { class: 'fa-compare' }, [
        compareLane(text('cloudbase_ai'), row, 'system', text(`system_${row.system.status}`)),
        compareLane(text('gpt'), row, 'gpt', text(`gpt_${row.gpt.status}`)),
      ]),
    ])) : [h('p', { class: 'fa-empty' }, text('empty'))]));
    if (modal) main.append(modal);
  }
  const head = pageHead({ kicker: text('kicker'), title: text('title'), sub: text('person_description'), actions: [
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { createForm.hidden = !createForm.hidden; } },
      [ic('plus'), text('new_advice')]),
    h('a', { class: 'btn btn-soft', href: '#/ai/followup-tasks' }, [ic('list'), text('gpt_tasks')]),
  ] });
  const legacy = legacyRows.length ? h('details', { class: 'fa-legacy' }, [h('summary', {}, text('legacy_history')),
    ...legacyRows.slice(0, 10).map(item => h('article', { class: 'fa-legacy-row' }, [
      h('b', {}, new Date(item.createdAt).toLocaleString()),
      ...(item.candidates || []).map(candidate => h('p', {}, candidate.candidate?.summary || '—')),
    ]))]) : null;
  main.replaceChildren(head, h('p', { class: 'fa-page-status' }, text('parallel_notice')), status,
    createForm, listRoot, legacy);
  void load().catch(() => { status.textContent = text('load_failed'); });
}

export function renderFollowupAdviceTasks(ctx) {
  const main = ctx.main;
  let taskPackage = null, previews = [], afterId = null;
  const status = h('p', { class: 'fa-page-status', role: 'status' });
  const packageBox = h('textarea', { class: 'fa-json-box', rows: 14, readonly: true, 'aria-label': text('task_package') });
  const nextButton = h('button', { class: 'btn btn-ghost', type: 'button', disabled: true,
    onclick: async () => { if (!taskPackage?.nextAfterId) return; afterId = taskPackage.nextAfterId; await loadPackage(); } }, text('next_package'));
  const resultBox = h('textarea', { class: 'fa-json-box', rows: 12, placeholder: text('paste_gpt_json') });
  const previewRoot = h('div', { class: 'fa-list' });
  async function loadPackage() {
    status.textContent = text('loading_package');
    try {
      taskPackage = await data.gptFollowupTaskPackage(ctx, { limit: 10, ...(afterId ? { afterId } : {}) });
      packageBox.value = JSON.stringify(taskPackage, null, 2); nextButton.disabled = !taskPackage?.nextAfterId;
      status.textContent = text('package_ready');
    } catch (_) { status.textContent = text('load_failed'); }
  }
  async function preview() {
    try {
      const payload = JSON.parse(resultBox.value);
      const value = await data.previewGptFollowupImport(ctx, payload);
      previews = value.rows || []; drawPreviews(); status.textContent = text('preview_ready');
    } catch (_) { status.textContent = text('invalid_json'); }
  }
  function drawPreviews() {
    previewRoot.replaceChildren(...previews.map(item => h('article', { class: 'fa-row fa-preview-row' }, [
      h('h3', {}, item.title || `${text('advice_id')} ${item.adviceId}`),
      h('p', { class: `fa-status fa-status-${item.status}` }, text(`preview_${item.status}`)),
      item.gptAdvice ? h('div', { class: 'fa-preview-copy' }, [h('section', {}, [h('b', {}, text('overall_strategy')),
        h('p', {}, item.gptAdvice.overallStrategy)]), h('section', {}, [h('b', {}, text('product_service_advice')),
        h('p', {}, item.gptAdvice.productServiceAdvice)])]) : null,
      item.status === 'preview' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
        event.currentTarget.disabled = true;
        try { await data.confirmGptFollowupImport(ctx, { adviceId: item.adviceId, personId: item.personId,
          systemVersion: item.systemVersion, previewId: item.previewId, confirmed: true });
          item.status = 'saved'; drawPreviews();
        } catch (_) { item.status = 'stale'; drawPreviews(); }
      } }, text('confirm_save_gpt')) : null,
    ])));
  }
  const head = pageHead({ kicker: text('kicker'), title: text('gpt_tasks'), sub: text('task_description'), actions: [
    h('a', { class: 'btn btn-ghost', href: '#/people' }, text('people')),
  ] });
  main.replaceChildren(head, h('p', { class: 'fa-page-status' }, text('privacy_notice')), status,
    h('section', { class: 'fa-task-step' }, [h('h2', {}, text('step_export')),
      h('p', {}, text('step_export_help')),
      h('div', { class: 'fa-actions' }, [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { afterId = null; await loadPackage(); } }, text('create_package')),
        nextButton,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(packageBox.value); status.textContent = text('copied'); } catch (_) {} } }, text('copy_package'))]),
      packageBox]),
    h('section', { class: 'fa-task-step' }, [h('h2', {}, text('step_import')),
      h('p', {}, text('step_import_help')), resultBox,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: preview }, text('preview_import'))]),
    previewRoot);
  void loadPackage();
}
