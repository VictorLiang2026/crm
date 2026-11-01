import { h } from './dom.js';
import { ic } from './icons.js';
import { pageHead } from './ui.js';
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

function editDialog(laneName, lane, onClose, onSave) {
  const input = (labelKey, value, area = true) => {
    const control = h(area ? 'textarea' : 'input', area ? { rows: 5, maxlength: 4000 } : { type: 'text', maxlength: 240 });
    control.value = value || '';
    return { control, node: h('label', { class: 'fa-form-field' }, [h('span', {}, text(labelKey)), control]) };
  };
  const title = input('advice_title', lane.title, false);
  const strategy = input('overall_strategy', lane.strategy);
  const product = input('product_service_advice', lane.productAdvice);
  const status = h('p', { class: 'fa-form-status', role: 'status' });
  const panel = h('section', { class: 'fa-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fa-edit-title' }, [
    h('header', {}, [h('h2', { id: 'fa-edit-title' }, `${text('edit')} · ${laneName}`),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('close'))]),
    title.node, strategy.node, product.node, status,
    h('footer', {}, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
        event.currentTarget.disabled = true; status.textContent = text('saving');
        try { await onSave({ title: title.control.value, strategy: strategy.control.value, productAdvice: product.control.value }); onClose(); }
        catch (_) { status.textContent = text('save_failed'); event.currentTarget.disabled = false; }
      } }, text('save'))]),
  ]);
  return h('div', { class: 'fa-modal-overlay', onclick: event => { if (event.target === event.currentTarget) onClose(); } }, panel);
}

function compareLane(label, lane, variant, statusText, options = {}) {
  const available = lane.status === 'ready' || lane.status === 'manual' || lane.status === 'stale' || lane.status === 'kept';
  return h('article', { class: `fa-lane fa-lane-${variant}` }, [
    h('header', { class: 'fa-lane-head' }, [h('div', {}, [h('h3', {}, label),
      available ? h('h4', { class: 'fa-lane-title' }, lane.title || '—') : null]),
      h('div', { class: 'fa-row-actions' }, [
        h('span', { class: `fa-status fa-status-${lane.status || 'pending'}` }, statusText),
        available && options.onEdit ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: options.onEdit },
          [ic('edit'), text('edit')]) : null,
        available && options.onDelete ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: options.onDelete },
          [ic('trash'), text('delete')]) : null,
      ])]),
    available ? h('div', {}, [section('overall_strategy', lane.strategy, lane.strategySources),
      section('product_service_advice', lane.productAdvice, lane.productSources),
      lane.basedOnSystemVersion ? h('p', { class: 'fa-muted' }, `${text('based_on_version')} ${lane.basedOnSystemVersion}`) : null]) :
      h('p', { class: 'fa-empty fa-lane-empty' }, options.emptyText || text('gpt_skill_pending')),
  ]);
}

export function renderFollowupAdvice(ctx, personId) {
  const main = ctx.main;
  let rows = [], legacyRows = [], busy = false, modal = null;
  const status = h('p', { class: 'fa-page-status', role: 'status' });
  const listRoot = h('div', { class: 'fa-list' });
  const createButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    if (busy) return;
    busy = true; createButton.disabled = true; status.textContent = text('generating');
    const clientRequestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000`;
    try {
      await data.generateFollowupAdvice(ctx, { personId: String(personId), clientRequestId });
      await load(); status.textContent = text('generated');
    } catch (_) { status.textContent = text('generate_failed'); }
    finally { busy = false; createButton.disabled = false; }
  } }, [ic('sparkle'), text('generate_system')]);
  async function load() {
    const [current, legacy] = await Promise.all([
      data.followupAdviceList(ctx, personId),
      data.dualFollowupHistory(ctx, personId).catch(() => ({ rows: [] })),
    ]);
    rows = current.rows || []; legacyRows = legacy.rows || []; draw();
  }
  function edit(row, laneKey) {
    const isSystem = laneKey === 'system';
    const lane = isSystem ? { ...row.system, title: row.system.title || row.title } : row.gpt;
    const label = isSystem ? text('cloudbase_ai') : text('gpt');
    modal = editDialog(label, lane, () => { modal?.remove(); modal = null; draw(); }, async changes => {
      await data.updateFollowupAdvice(ctx, { id: row.id, personId: String(personId), lane: laneKey,
        systemVersion: row.system.version, updatedAt: row.updatedAt, ...changes, action: 'edit' });
      await load();
    });
    draw();
  }
  async function remove(row, laneKey) {
    const key = laneKey === 'system' ? 'confirm_delete_system' : 'confirm_delete_gpt';
    if (!window.confirm(text(key))) return;
    try {
      if (laneKey === 'system') await data.deleteFollowupAdvice(ctx, { id: row.id, personId: String(personId), updatedAt: row.updatedAt });
      else await data.updateFollowupAdvice(ctx, { id: row.id, personId: String(personId), lane: 'gpt', action: 'delete',
        systemVersion: row.system.version, updatedAt: row.updatedAt });
      await load();
    } catch (_) { status.textContent = text('save_failed'); }
  }
  function draw() {
    listRoot.replaceChildren(...(rows.length ? rows.map(row => h('article', { class: 'fa-row' }, [
      h('p', { class: 'fa-muted' }, `${text('system_version')} ${row.system.version} · ${new Date(row.updatedAt).toLocaleString()}`),
      h('div', { class: 'fa-compare' }, [
        compareLane(text('cloudbase_ai'), row.system, 'system', text(`system_${row.system.status}`), {
          onEdit: row.system.status === 'ready' ? () => edit(row, 'system') : null,
          onDelete: row.system.status === 'ready' ? () => remove(row, 'system') : null,
          emptyText: text(row.system.status === 'failed' ? 'system_failed' : 'system_generating'),
        }),
        compareLane(text('gpt'), row.gpt, 'gpt', text(`gpt_${row.gpt.status}`), {
          onEdit: row.gpt.strategy ? () => edit(row, 'gpt') : null,
          onDelete: row.gpt.strategy ? () => remove(row, 'gpt') : null,
          emptyText: text('gpt_skill_pending'),
        }),
      ]),
    ])) : [h('p', { class: 'fa-empty' }, text('empty'))]));
    if (modal) main.append(modal);
  }
  const head = pageHead({ kicker: text('kicker'), title: text('title'), sub: text('person_description'), actions: [createButton] });
  const legacy = legacyRows.length ? h('details', { class: 'fa-legacy' }, [h('summary', {}, text('legacy_history')),
    ...legacyRows.slice(0, 10).map(item => h('article', { class: 'fa-legacy-row' }, [
      h('b', {}, new Date(item.createdAt).toLocaleString()),
      ...(item.candidates || []).map(candidate => h('p', {}, candidate.candidate?.summary || '—')),
    ]))]) : null;
  main.replaceChildren(head, h('p', { class: 'fa-page-status' }, text('parallel_notice')), status, listRoot, legacy);
  void load().catch(() => { status.textContent = text('load_failed'); });
}

// Keep the old route resolvable while the ChatGPT SKILL is being built.
export function renderFollowupAdviceTasks(ctx) {
  const main = ctx.main;
  main.replaceChildren(pageHead({ kicker: text('kicker'), title: text('gpt_tasks'), sub: text('task_description'), actions: [
    h('a', { class: 'btn btn-ghost', href: '#/people' }, text('people')),
  ] }), h('p', { class: 'fa-empty' }, text('gpt_skill_pending')));
}
