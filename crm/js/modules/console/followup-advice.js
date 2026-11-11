import { knowledgeLine, strategyEvidence, versionFeedback } from './advice-evidence.js';
import { h } from './dom.js';
import { ic } from './icons.js';
import { pageHead } from './ui.js';
import { data } from './data.js';
import { t } from './i18n.js';

const text = key => t(`fa_${key}`);
const generationErrorKey = code => ({
  TEST_DATA_BLOCKED: 'generation_test_blocked',
  TEST_DATA_SCOPE_UNVERIFIED: 'generation_source_unverified',
  TEST_DATA_OUTPUT_BLOCKED: 'generation_output_blocked',
  AI_TASK_TIMEOUT: 'generation_timeout',
  AI_AUDIT_UNKNOWN: 'generation_status_unknown',
  AI_REQUEST_FAILED: 'generate_failed',
}[code] || 'generate_failed');
const sourceList = (items = []) => items.length ? h('ul', { class: 'fa-sources' }, items.map(source =>
  h('li', {}, h('a', { href: '#/knowledge-governance?item='+encodeURIComponent(source.id??source) },
    knowledgeLine(source))))) : h('p', { class: 'fa-muted' }, text('no_sources'));

function section(titleKey, content, sources) {
  return h('section', { class: 'fa-section' }, [h('h4', {}, text(titleKey)),
    h('p', {}, content || '—'), h('details', {}, [h('summary', {}, text('sources')), sourceList(sources || [])])]);
}

function editDialog(row, onClose, onSave) {
  const input = (labelKey, value, area = true) => {
    const control = h(area ? 'textarea' : 'input', area ? { rows: 5, maxlength: 4000 } : { type: 'text', maxlength: 240 });
    control.value = value || '';
    return { control, node: h('label', { class: 'fa-form-field' }, [h('span', {}, text(labelKey)), control]) };
  };
  const systemTitle = input('advice_title', row.system.title || row.title, false);
  const systemStrategy = input('system_strategy_label', row.system.strategy);
  const systemProduct = input('system_product_label', row.system.productAdvice);
  const systemMessage = input('system_message_label', row.system.messageDraft);
  const gptExists = Boolean(row.gpt.strategy || row.gpt.productAdvice || row.gpt.messageDraft);
  const gptTitle = gptExists ? input('advice_title', row.gpt.title, false) : null;
  const gptStrategy = gptExists ? input('gpt_strategy_label', row.gpt.strategy) : null;
  const gptProduct = gptExists ? input('gpt_product_label', row.gpt.productAdvice) : null;
  const gptMessage = gptExists ? input('gpt_message_label', row.gpt.messageDraft) : null;
  const gptAction = gptExists ? h('select', { class: 'fa-edit-policy-select', onchange: event => {
    gptFields.hidden = event.currentTarget.value !== 'edit';
  } }, [
    h('option', { value: 'keep' }, text('keep_gpt')),
    h('option', { value: 'edit' }, text('edit_gpt')),
    h('option', { value: 'delete' }, text('delete_gpt')),
  ]) : null;
  const gptFields = gptExists ? h('div', { class: 'fa-edit-fields', hidden: true }, [
    gptTitle.node, gptStrategy.node, gptProduct.node, gptMessage.node,
  ]) : null;
  const status = h('p', { class: 'fa-form-status', role: 'status' });
  const panel = h('section', { class: 'fa-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fa-edit-title' }, [
    h('header', {}, [h('h2', { id: 'fa-edit-title' }, text('edit_title')),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('close'))]),
    h('section', { class: 'fa-edit-group' }, [h('h3', {}, text('cloudbase_ai')),
      systemTitle.node, systemStrategy.node, systemProduct.node, systemMessage.node]),
    gptExists ? h('section', { class: 'fa-edit-group' }, [h('h3', {}, text('gpt')),
      h('label', { class: 'fa-form-field' }, [h('span', {}, text('gpt_edit_policy')), gptAction]), gptFields]) :
      h('p', { class: 'fa-muted' }, text('gpt_empty_edit_hint')),
    status,
    h('footer', {}, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: onClose }, text('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
        event.currentTarget.disabled = true; status.textContent = text('saving');
        try { await onSave({
          title: systemTitle.control.value, strategy: systemStrategy.control.value, productAdvice: systemProduct.control.value,
          messageDraft: systemMessage.control.value,
          ...(gptExists ? { gptAction: gptAction.value,
            ...(gptAction.value === 'edit' ? { gptTitle: gptTitle.control.value,
              gptStrategy: gptStrategy.control.value, gptProductAdvice: gptProduct.control.value,
              gptMessageDraft: gptMessage.control.value } : {}) } : {}),
        }); onClose(); }
        catch (_) { status.textContent = text('save_failed'); event.currentTarget.disabled = false; }
      } }, text('save'))]),
  ]);
  return h('div', { class: 'fa-modal-overlay', onclick: event => { if (event.target === event.currentTarget) onClose(); } }, panel);
}

function compareLane(label, lane, variant, statusText, emptyText, ctx, row) {
  const available = lane.status === 'ready' || lane.status === 'manual' || lane.status === 'stale' || lane.status === 'kept';
  return h('article', { class: `fa-lane fa-lane-${variant}` }, [
    h('header', { class: 'fa-lane-head' }, [h('div', {}, [h('h3', {}, label),
      available ? h('h4', { class: 'fa-lane-title' }, lane.title || '—') : null]),
      h('span', { class: `fa-status fa-status-${lane.status || 'pending'}` }, statusText)]),
    available ? h('div', {}, [section('overall_strategy', lane.strategy, lane.strategySources),
      section('product_service_advice', lane.productAdvice, lane.productSources),
      lane.messageDraft ? section('wechat_message', lane.messageDraft, []) : null,
      versionFeedback(ctx,{lane:variant,adviceId:row.id,subjectId:row.personId,updatedAt:row.updatedAt},{
        ...strategyEvidence(lane.strategy),
        knowledge:{status:'referenced',sources:[...new Map([...(lane.strategySources||[]),...(lane.productSources||[])].map(s=>[s.id??s,s])).values()]}
      }),
      lane.basedOnSystemVersion ? h('p', { class: 'fa-muted' }, `${text('based_on_version')} ${lane.basedOnSystemVersion}`) : null]) :
      h('p', { class: 'fa-empty fa-lane-empty' }, emptyText || text('gpt_skill_pending')),
  ]);
}

function scriptLane(labelKey, lane = {}, variant, sharedTitle) {
  const message = String(lane.messageDraft || '').trim();
  const status = lane.status || (message ? (variant === 'system' ? 'ready' : 'manual') : 'pending');
  const laneTitle = lane.title && lane.title !== sharedTitle ? lane.title : '';
  const version = variant === 'system' && lane.version
    ? `${text('system_version')} ${lane.version}`
    : variant === 'gpt' && lane.basedOnSystemVersion
      ? `${text('based_on_version')} ${lane.basedOnSystemVersion}` : '';
  return h('article', { class: `fa-lane fa-lane-${variant} fa-script-lane` }, [
    h('header', { class: 'fa-lane-head' }, [h('div', {}, [h('h3', {}, text(labelKey)),
      laneTitle ? h('p', { class: 'fa-script-meta' }, laneTitle) : null,
      version ? h('p', { class: 'fa-script-meta' }, version) : null]),
      h('span', { class: `fa-status fa-status-${status}` }, text(`${variant}_${status}`))]),
    message ? h('p', { class: 'fa-script-text' }, message)
      : h('p', { class: 'fa-empty fa-lane-empty fa-script-empty' }, text('scripts_lane_empty')),
  ]);
}

export function renderFollowupAdvice(ctx, personId) {
  const main = ctx.main;
  let rows = [], legacyRows = [], busy = false, modal = null;
  const status = h('p', { class: 'fa-page-status', role: 'status' });
  const listRoot = h('div', { class: 'fa-list' });
  const scriptsButton = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { void showScripts(); } }, [
    ic('chat'), text('scripts_button'),
  ]);
  const createButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    if (busy) return;
    busy = true; createButton.disabled = true; status.textContent = text('generating');
    const clientRequestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000`;
    try {
      await data.generateFollowupAdvice(ctx, { personId: String(personId), clientRequestId });
      await load(); status.textContent = text('generated');
    } catch (error) { status.textContent = text(generationErrorKey(error?.code)); }
    finally { busy = false; createButton.disabled = false; }
  } }, [ic('sparkle'), text('generate_system')]);
  async function load() {
    const [current, legacy] = await Promise.all([
      data.followupAdviceList(ctx, personId),
      data.dualFollowupHistory(ctx, personId).catch(() => ({ rows: [] })),
    ]);
    rows = current.rows || []; legacyRows = legacy.rows || []; draw();
  }
  async function showScripts() {
    if (busy || modal) return;
    const pageSize = 25;
    let pageOffset = 0, pageHasMore = false, requestId = 0;
    const pageStatus = h('p', { class: 'fa-script-status', role: 'status', 'aria-live': 'polite' }, text('scripts_loading'));
    const scriptList = h('div', { class: 'fa-scripts-list' });
    const pageLabel = h('span', { class: 'fa-script-page' });
    const previous = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: true,
      onclick: () => { void loadScriptPage(Math.max(0, pageOffset - pageSize)); } }, text('scripts_previous'));
    const next = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: true,
      onclick: () => { if (pageHasMore) void loadScriptPage(pageOffset + pageSize); } }, text('scripts_next'));
    const close = () => { if (modal === overlay) { overlay.remove(); modal = null; draw(); } };
    const panel = h('section', { class: 'fa-modal fa-scripts-modal', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'fa-scripts-title' }, [
      h('header', {}, [h('div', {}, [h('h2', { id: 'fa-scripts-title' }, text('scripts_title')),
        h('p', { class: 'fa-muted' }, text('scripts_description'))]),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, text('close'))]),
      pageStatus, scriptList,
      h('footer', { class: 'fa-script-pager' }, [previous, pageLabel, next]),
    ]);
    const overlay = h('div', { class: 'fa-modal-overlay', onclick: event => {
      if (event.target === event.currentTarget) close();
    } }, panel);
    modal = overlay; draw();
    async function loadScriptPage(offset) {
      const currentRequest = ++requestId;
      pageOffset = offset; pageHasMore = false;
      previous.disabled = offset <= 0; next.disabled = true;
      pageStatus.textContent = text('scripts_loading');
      scriptList.replaceChildren();
      try {
        const result = await data.followupAdviceList(ctx, String(personId), { limit: pageSize, offset });
        if (currentRequest !== requestId || modal !== overlay) return;
        const scripts = (result.rows || []).filter(row =>
          String(row.system?.messageDraft || '').trim() || String(row.gpt?.messageDraft || '').trim());
        pageHasMore = result.hasMore === true; pageOffset = Number(result.offset ?? offset);
        previous.disabled = pageOffset <= 0; next.disabled = !pageHasMore;
        pageLabel.textContent = text('scripts_page').replace('{page}', String(Math.floor(pageOffset / pageSize) + 1));
        pageStatus.textContent = scripts.length ? '' : text(pageHasMore ? 'scripts_page_empty' : 'scripts_empty');
        scriptList.replaceChildren(...scripts.map(row => {
          const title = row.title || row.system?.title || row.gpt?.title || text('advice_title');
          return h('article', { class: 'fa-script-card' }, [
          h('header', {}, [h('div', {}, [h('h3', {}, title),
            h('p', { class: 'fa-script-meta' }, new Date(row.updatedAt).toLocaleString())])]),
          h('div', { class: 'fa-compare fa-script-compare' }, [
            scriptLane('scripts_cloudbase_heading', row.system, 'system', title),
            scriptLane('scripts_gpt_heading', row.gpt, 'gpt', title),
          ]),
          ]);
        }));
      } catch (_) {
        if (currentRequest !== requestId || modal !== overlay) return;
        pageStatus.textContent = text('scripts_load_failed');
        const retry = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          void loadScriptPage(pageOffset);
        } }, text('scripts_retry'));
        scriptList.replaceChildren(retry);
      }
    }
    await loadScriptPage(0);
  }
  function edit(row) {
    modal = editDialog(row, () => { modal?.remove(); modal = null; draw(); }, async changes => {
      await data.updateFollowupAdvice(ctx, { id: row.id, personId: String(personId), lane: 'pair',
        systemVersion: row.system.version, updatedAt: row.updatedAt, ...changes });
      await load();
    });
    draw();
  }
  async function remove(row) {
    if (!window.confirm(text('confirm_delete'))) return;
    try {
      await data.deleteFollowupAdvice(ctx, { id: row.id, personId: String(personId), updatedAt: row.updatedAt });
      await load();
    } catch (_) { status.textContent = text('save_failed'); }
  }
  function draw() {
    listRoot.replaceChildren(...(rows.length ? rows.map(row => h('article', { class: 'fa-row' }, [
      h('header', { class: 'fa-row-head' }, [h('div', {}, [h('h2', {}, row.title || row.system.title || '—'),
        h('p', {}, `${text('system_version')} ${row.system.version} · ${new Date(row.updatedAt).toLocaleString()}`)]),
        ['ready', 'failed'].includes(row.system.status) ? h('div', { class: 'fa-row-actions' }, [
          row.system.status === 'ready' ? h('button', { class: 'btn btn-ghost btn-sm fa-row-edit', type: 'button', onclick: () => edit(row) },
            [ic('edit'), text('edit')]) : null,
          h('button', { class: 'btn btn-ghost btn-sm fa-row-delete', type: 'button', onclick: () => remove(row) },
            [ic('trash'), text('delete')]),
        ]) : null]),
      h('div', { class: 'fa-compare' }, [
        compareLane(text('cloudbase_ai'), row.system, 'system', text(`system_${row.system.status}`),
          text(row.system.status === 'failed' ? 'system_failed' : 'system_generating'),ctx,row),
        compareLane(text('gpt'), row.gpt, 'gpt', text(`gpt_${row.gpt.status}`), text('gpt_skill_pending'),ctx,row),
      ]),
    ])) : [h('p', { class: 'fa-empty' }, text('empty'))]));
    if (modal) main.append(modal);
  }
  const head = pageHead({ kicker: text('kicker'), title: text('title'), sub: text('person_description'), actions: [scriptsButton, createButton] });
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
