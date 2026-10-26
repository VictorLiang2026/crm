// Console 写入闭环（WP2）：命令式写入走「服务端预览 → 人工确认 → 执行」。
// 所有写入经云函数，不直连数据库：
// - 行动/承诺完成: person_360 previewWorkItem{data:{idempotencyKey,kind,operation,personId,itemId,draft}}
//     → {previewId,preview:{before,after}} → executeWorkItem{previewId}
// - 机会推进/关闭/新建: person_360 previewOpportunity/executeOpportunity（stage/close/create）
// - 机会候选三键: assistant opportunityCandidate edit/reject/preview→confirm(previewHash)→execute
// - 快速记录: ai_parse quick_capture（只读解析）→ person_360 resolveQuickCaptureName（服务端身份解析）
//     → 人工点选候选 → 完整服务端预览 → 人工确认 → 单事务执行。
import { h } from './dom.js';
import { ic } from './icons.js';
import { bdg, fmtDate, dueLabel, textOf } from './ui.js';
import { t, getLang, translateEnum } from './i18n.js';
import { data } from './data.js';

// ---------- 调用与错误归一 ----------
async function p360(ctx, action, extra) {
  const res = await ctx.api.call('person_360', { action, ...(extra || {}) });
  if (res && res.error) throw new Error(String(res.error));
  return res;
}
async function assistant(ctx, params) {
  const res = await ctx.api.call('assistant', params);
  if (res && res.ok === false && res.error) {
    const e = res.error;
    throw new Error((e && e.message) ? String(e.message) : '操作未完成');
  }
  return res;
}
async function aiParse(ctx, params) {
  const res = await ctx.api.call('ai_parse', params);
  if (res && res.error) throw new Error(String(res.error));
  return res;
}
function uuid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 继续 */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
const OPP_TYPES = ['insurance', 'recruit', 'referral', 'activity', 'speaker', 'partnership', 'service', 'relationship'];
// 枚举翻译统一走 i18n.js 集中注册表
const oppTypeLabel = (type) => translateEnum('opportunity_type', type);
const stageLabel = (s) => translateEnum('opportunity_stage', s);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 服务端要求 interaction.at 为带时区偏移的完整 ISO（YYYY-MM-DDTHH:mm:ss+08:00）。
function dateToIso(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T09:00:00`) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(offMin) / 60))}:${p(Math.abs(offMin) % 60)}`;
}

// ---------- Bottom Sheet 骨架 ----------
export function openSheet({ title, sub, body }) {
  const errBox = h('div', { class: 'sheet-err', style: 'display:none' });
  const bodyEl = h('div', {}, [body, errBox]);
  const sheetEl = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, [
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, [
      h('b', { class: 'sheet-title' }, title),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': t('close_aria'),
        onclick: () => closeSheet(),
      }, [ic('x')]),
    ]),
    sub ? h('p', { class: 'sheet-sub' }, sub) : null,
    bodyEl,
  ]);
  const overlay = h('div', { class: 'sheet-overlay' }, [sheetEl]);

  // ---- 下滑关闭（仅移动端 handle 区域触发） ----
  let startY = 0, dragY = 0, dragging = false;
  const handle = sheetEl.querySelector('.sheet-handle');
  handle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY; dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dragY = e.touches[0].clientY - startY;
    if (dragY > 0) {
      sheetEl.style.transform = `translateY(${dragY}px)`;
      overlay.style.background = `rgba(24,28,34,${Math.max(0.15, 0.45 - dragY / 600)})`;
    }
  }, { passive: true });
  handle.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = 'transform .25s ease';
    if (dragY > 80) {
      closeSheet();
    } else {
      sheetEl.style.transform = '';
      overlay.style.background = '';
    }
    dragY = 0;
  });

  // ---- 键盘避让：visualViewport 变化时限制 sheet 最大高度 ----
  let vpHandler = null;
  if (window.visualViewport) {
    vpHandler = () => { sheetEl.style.maxHeight = `${window.visualViewport.height * 0.88}px`; };
    window.visualViewport.addEventListener('resize', vpHandler);
    vpHandler();
  }

  function closeSheet() {
    if (vpHandler && window.visualViewport) window.visualViewport.removeEventListener('resize', vpHandler);
    sheetEl.style.transition = 'transform .25s ease';
    sheetEl.style.transform = 'translateY(100%)';
    overlay.style.background = 'rgba(24,28,34,0)';
    setTimeout(() => overlay.remove(), 250);
  }

  return {
    overlay,
    showErr(msg) {
      errBox.textContent = String(msg || '操作未完成').slice(0, 200);
      errBox.style.display = '';
    },
    swap(node) { errBox.style.display = 'none'; bodyEl.replaceChildren(node, errBox); },
  };
}
function busy(btn, on, label) {
  btn.disabled = on;
  if (label !== undefined) btn.textContent = label;
}
function fieldRow(label, input, note) {
  return h('div', { class: 'sheet-field' }, [
    h('label', {}, label), input,
    note ? h('div', { class: 'sheet-note', style: 'margin-top:4px' }, note) : null,
  ]);
}
function sel(options, value, attrs) {
  const s = h('select', { class: 'sheet-select', ...(attrs || {}) },
    options.map((o) => h('option', { value: o[0], ...(o[0] === value ? { selected: true } : {}) }, o[1])));
  return s;
}
function previewBlock(rows) {
  return h('div', { class: 'sheet-preview' }, rows);
}
function kvRow(k, v) {
  return v ? h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, k), h('span', {}, v)]) : null;
}

// ---------- 行动/承诺：完成 ----------
export function openWorkItemDone(ctx, { row, onDone }) {
  const kind = row.kind === 'commitment' ? 'commitment' : 'action';
  const titleText = kind === 'action' ? (row.title || t('unnamed_action')) : (row.content || t('no_content'));
  const body = h('div', {}, [
    h('p', { class: 'sheet-note', style: 'margin:0 0 10px' },
      t('preview_note')),
  ]);
  const sheet = openSheet({ title: kind === 'action' ? t('complete_action') : t('complete_commitment'), sub: titleText, body });
  document.body.appendChild(sheet.overlay);
  (async () => {
    const res = await p360(ctx, 'previewWorkItem', { data: {
      idempotencyKey: uuid(), kind, operation: 'complete',
      personId: String(row.person_id), itemId: String(row.id), draft: {},
    } });
    const pv = res.preview || {};
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow(t('target'), pv.personName || ''),
        kvRow(t('content'), titleText),
        kvRow(t('due'), row.due_at ? dueLabel(String(row.due_at).slice(0, 10)) : ''),
        h('div', { class: 'kv-line' }, [
          h('span', { class: 'kv-k' }, t('status')), bdg(t('pending'), 'gold'), h('span', {}, ' → '), bdg(t('completed'), 'jade'),
        ]),
        res.expiresAt ? h('div', { class: 'sheet-note', style: 'margin-top:8px' },
          `${t('preview_valid_until')} ${fmtDate(String(res.expiresAt).slice(0, 10))}${t('preview_expires_note')}`) : null,
      ]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            busy(btn, true, t('writing'));
            try {
              await p360(ctx, 'executeWorkItem', { previewId: res.previewId });
              sheet.overlay.remove();
              // 撤销：重新打开该行动/承诺（服务端 work-item-service 支持 reopen）
              const undoId = row.id;
              const undoKind = kind;
              const undoPersonId = row.person_id;
              ctx.toast(undoKind === 'action' ? t('action_completed') : t('commitment_fulfilled'), {
                type: 'ok',
                undoLabel: t('btn_undo'),
                onUndo: async () => {
                  try {
                    const pv = await p360(ctx, 'previewWorkItem', { data: {
                      idempotencyKey: uuid(), kind: undoKind, operation: 'reopen',
                      personId: String(undoPersonId), itemId: String(undoId), draft: {},
                    } });
                    await p360(ctx, 'executeWorkItem', { previewId: pv.previewId });
                    ctx.toast(undoKind === 'action' ? t('action_reopened') : t('commitment_reopened'), 'ok');
                    if (onDone) onDone();
                  } catch (e) { ctx.toast(String(e.message || t('undo_failed')), 'err'); }
                },
              });
              if (onDone) onDone();
            } catch (err) { busy(btn, false, t('confirm_complete')); sheet.showErr(err.message); }
          },
        }, t('confirm_complete')),
      ]),
    ]));
  })().catch((err) => {
    sheet.swap(h('div', {}, [h('div', { class: 'sheet-err' },
      (err.message || '').includes('state changed')
        ? t('state_changed')
        : (err.message || t('preview_failed')))]));
  });
}

function workItemLocalDateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  const part = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function workItemSource(row) {
  if (!row) return null;
  const sourceName = row.activity_id ? t('work_source_activity')
    : row.opportunity_id ? t('work_source_opportunity')
    : row.interaction_id ? t('work_source_interaction')
    : row.source ? translateEnum('work_source', row.source) : t('work_source_manual');
  const label = row.opportunity_id ? `${sourceName} #${row.opportunity_id}` : sourceName;
  const href = row.activity_id ? `#/activity/${row.activity_id}`
    : row.opportunity_id ? '#/opportunities' : null;
  return href
    ? h('a', { class: 'sheet-note', href, title: label }, label)
    : h('span', { class: 'sheet-note' }, label);
}

function workItemDueLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return t('no_date');
  const locale = getLang() === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function workItemSummary(kind, draft, row) {
  if (kind === 'action') return [
    [t('field_title'), draft.title || row?.title],
    [t('field_description'), draft.description || row?.description],
    [t('field_due'), draft.dueAt || row?.due_at ? workItemDueLabel(draft.dueAt || row?.due_at) : t('no_date')],
    [t('field_priority'), translateEnum('work_priority', draft.priority || row?.priority)],
  ];
  return [
    [t('field_content'), draft.content || row?.content],
    [t('field_due'), draft.dueAt || row?.due_at ? workItemDueLabel(draft.dueAt || row?.due_at) : t('no_date')],
    [t('field_commitment_type'), translateEnum('commitment_type', draft.commitmentType || row?.commitment_type)],
  ];
}

function workItemValues(kind, draft, row) {
  return workItemSummary(kind, draft, row).map(([label, value]) =>
    value ? h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, label), h('span', {}, String(value))]) : null);
}

/** Native Person/Today work item editor. All writes remain preview → confirm → execute. */
export function openWorkItemEditor(ctx, { kind = 'action', row = null, personId = null,
  personName = '', initialTitle = '', initialDescription = '',
  initialCommitmentType = '', onDone } = {}) {
  const isAction = kind === 'action';
  const initialPerson = row?.person_id || personId || '';
  const chosen = { id: initialPerson ? String(initialPerson) : '', name: row?.person_name || personName || '' };
  const title = row ? t(isAction ? 'edit_action' : 'edit_commitment')
    : t(isAction ? 'create_action' : 'create_commitment');
  const text = isAction ? h('input', { class: 'sheet-input', maxlength: 200, value: row?.title || initialTitle })
    : h('textarea', { class: 'sheet-textarea', maxlength: 4000, rows: 3 }, row?.content || initialTitle);
  const description = isAction ? h('textarea', { class: 'sheet-textarea', maxlength: 4000, rows: 2 }, row?.description || initialDescription) : null;
  const priority = isAction ? sel([
    ['low', t('priority_low')], ['medium', t('priority_medium')],
    ['high', t('priority_high')], ['urgent', t('priority_urgent')],
  ], row?.priority || 'medium', { 'aria-label': t('field_priority') }) : null;
  const commitmentType = !isAction ? sel([
    ['I_PROMISED', t('commit_i_promised')], ['THEY_PROMISED', t('commit_they_promised')],
    ['MUTUAL', t('commit_mutual')],
  ], row?.commitment_type || initialCommitmentType || 'I_PROMISED', { 'aria-label': t('field_commitment_type') }) : null;
  const due = h('input', { class: 'sheet-input', type: 'datetime-local', value: workItemLocalDateTime(row?.due_at) });
  const personSearch = h('input', { class: 'sheet-input', type: 'search', maxlength: 80, placeholder: t('work_person_search') });
  const personMatches = h('div', { class: 'sheet-stack' });
  const personChoice = h('div', { class: 'sheet-note' }, chosen.id
    ? `${chosen.name || t('person')} · #${chosen.id}` : t('work_person_required'));
  const searchButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
    personMatches.replaceChildren(h('div', { class: 'sheet-note' }, t('loading')));
    try {
      const result = await data.listPeople(ctx, { keyword: personSearch.value.trim(), page: 1, pageSize: 20 });
      const candidates = result.rows || [];
      personMatches.replaceChildren(...(candidates.length ? candidates.map((candidate) => h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          chosen.id = String(candidate.id); chosen.name = candidate.display_name;
          personChoice.textContent = `${candidate.display_name} · #${candidate.id}`;
          personMatches.replaceChildren();
        },
      }, `${candidate.display_name} · #${candidate.id}`)) : [h('div', { class: 'sheet-note' }, t('work_person_no_matches'))]));
    } catch (error) { sheet.showErr(error.message || t('work_person_search_failed')); }
  } }, t('work_person_find'));
  const body = h('div', {}, [
    !chosen.id ? h('div', { class: 'sheet-stack' }, [
      fieldRow(t('person'), personSearch), searchButton, personChoice, personMatches,
    ]) : h('div', { class: 'sheet-note' }, `${chosen.name || t('person')} · #${chosen.id}`),
    fieldRow(t(isAction ? 'field_title' : 'field_content'), text),
    isAction ? fieldRow(t('field_description'), description) : null,
    isAction ? fieldRow(t('field_priority'), priority) : fieldRow(t('field_commitment_type'), commitmentType),
    fieldRow(t('field_due'), due, t('work_due_note')),
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: (event) => preview(event.currentTarget) }, t('generate_preview')),
    ]),
  ]);
  const sheet = openSheet({ title, sub: t('work_preview_note'), body });
  document.body.appendChild(sheet.overlay);

  async function preview(button) {
    if (!chosen.id) { sheet.showErr(t('work_person_required')); return; }
    if (!text.value.trim()) { sheet.showErr(t('work_title_required')); return; }
    const dueAt = due.value ? new Date(due.value).toISOString() : null;
    const draft = isAction ? { title: text.value.trim(), description: description.value,
      dueAt, priority: priority.value }
      : { content: text.value.trim(), dueAt, commitmentType: commitmentType.value };
    busy(button, true, t('previewing'));
    try {
      const operation = row ? 'edit' : 'create';
      const result = await p360(ctx, 'previewWorkItem', { data: {
        idempotencyKey: uuid(), kind, operation, personId: chosen.id,
        itemId: row?.id || null, draft,
      } });
      const preview = result.preview || {};
      sheet.swap(h('div', {}, [
        h('p', { class: 'sheet-note' }, t('work_preview_note')),
        previewBlock([
          kvRow(t('person'), `${preview.personName || chosen.name || t('person')} · #${chosen.id}`),
          kvRow(t('work_record_id'), row ? `#${preview.itemId || row.id}` : t('work_new_item')),
          preview.itemId && row ? h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('work_source')), workItemSource(row)]) : null,
          h('div', { class: 'sheet-preview-label' }, t('work_before')),
          ...(row ? workItemValues(kind, preview.before || {}, row) : [h('div', { class: 'sheet-note' }, t('work_new_item'))]),
          h('div', { class: 'sheet-preview-label' }, t('work_after')),
          ...workItemValues(kind, { ...draft, ...(preview.after || {}) }, null),
          preview.after?.status ? h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('status')),
            bdg(translateEnum('work_status', preview.after.status), 'gold')]) : null,
          result.expiresAt ? h('div', { class: 'sheet-note' }, `${t('preview_valid_until')} ${fmtDate(String(result.expiresAt).slice(0, 10))}`) : null,
          h('div', { class: 'sheet-note' }, t('work_version_binding')),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.swap(body) }, t('back_to_edit')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async (event) => {
            busy(event.currentTarget, true, t('writing'));
            try {
              const saved = await p360(ctx, 'executeWorkItem', { previewId: result.previewId });
              sheet.overlay.remove();
              ctx.toast(t(saved.replayed ? 'work_item_replayed' : 'work_item_saved'), 'ok');
              if (onDone) onDone(saved);
            } catch (error) {
              busy(button, false, t('generate_preview'));
              sheet.swap(body);
              sheet.showErr((error.message || '').toLowerCase().includes('changed') ? t('state_changed') : error.message || t('write_failed'));
            }
          } }, t('confirm_write')),
        ]),
      ]));
    } catch (error) {
      busy(button, false, t('generate_preview'));
      sheet.showErr((error.message || '').toLowerCase().includes('changed') ? t('state_changed') : error.message || t('preview_failed'));
    }
  }
}

export function openWorkItemTransition(ctx, { row, operation, onDone } = {}) {
  const kind = row.kind === 'commitment' ? 'commitment' : 'action';
  const verb = { complete: 'complete', cancel: 'cancel', reopen: 'reopen' }[operation];
  const label = t(operation === 'complete' ? (kind === 'action' ? 'complete_action' : 'complete_commitment')
    : operation === 'cancel' ? (kind === 'action' ? 'work_cancel_action' : 'work_cancel_commitment')
      : (kind === 'action' ? 'work_reopen_action' : 'work_reopen_commitment'));
  const source = workItemSource(row);
  const body = h('div', {}, [h('p', { class: 'sheet-note' }, t('work_preview_note')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (event) => preview(event.currentTarget) }, t('generate_preview')),
      ])]);
  const sheet = openSheet({ title: label, sub: row.title || row.content || t('work_item'), body });
  document.body.appendChild(sheet.overlay);
  async function preview(button) {
    busy(button, true, t('previewing'));
    try {
      const result = await p360(ctx, 'previewWorkItem', { data: {
        idempotencyKey: uuid(), kind, operation, personId: String(row.person_id), itemId: String(row.id), draft: {},
      } });
      const pv = result.preview || {};
      sheet.swap(h('div', {}, [previewBlock([
        kvRow(t('person'), `${pv.personName || row.person_name || t('person')} · #${row.person_id}`),
        kvRow(t('work_record_id'), `#${pv.itemId || row.id}`),
        h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('work_source')), source]),
        h('div', { class: 'sheet-preview-label' }, t('work_before')),
        ...workItemValues(kind, pv.before || {}, row),
        h('div', { class: 'sheet-preview-label' }, t('work_after')),
        ...workItemValues(kind, { ...row, ...(pv.after || {}) }, null),
        kvRow(t('status'), translateEnum('work_status', pv.after?.status)),
        result.expiresAt ? h('div', { class: 'sheet-note' }, `${t('preview_valid_until')} ${fmtDate(String(result.expiresAt).slice(0, 10))}`) : null,
        h('div', { class: 'sheet-note' }, t('work_version_binding')),
      ]), h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async (event) => {
          busy(event.currentTarget, true, t('writing'));
          try {
            const saved = await p360(ctx, 'executeWorkItem', { previewId: result.previewId });
            sheet.overlay.remove();
            ctx.toast(t(saved.replayed ? 'work_item_replayed' : operation === 'complete'
              ? (kind === 'action' ? 'action_completed' : 'commitment_fulfilled') : `work_${verb}_done`), 'ok');
            if (operation === 'complete' && kind === 'action') ctx.toast(t('work_outcome_reminder'), { type: 'info', duration: 6000 });
            if (onDone) onDone(saved);
          } catch (error) {
            busy(button, false, t('generate_preview'));
            sheet.swap(body);
            sheet.showErr((error.message || '').toLowerCase().includes('changed') ? t('state_changed') : error.message || t('write_failed'));
          }
        } }, t('confirm_write')),
      ])]));
    } catch (error) {
      busy(button, false, t('generate_preview'));
      sheet.showErr((error.message || '').toLowerCase().includes('changed') ? t('state_changed') : error.message || t('preview_failed'));
    }
  }
}

// ---------- 机会：推进 / 关闭 ----------
export function openOpportunityAdvance(ctx, { opportunity, personName, onDone }) {
  const status = opportunity.status || '发现';
  const modeSel = sel([['stage', t('advance_stage')], ['close', t('close_won')]], 'stage');
  const referral = ['referral','转介绍'].includes(opportunity.opportunity_type);
  const allowedStages = (referral ? ['潜在线索','已介绍','已联系','已建立关系'] : ['发现','沟通','方案']).filter((s) => s !== status);
  const stageSel = sel(allowedStages.map((s) => [s, stageLabel(s)]), allowedStages.includes('沟通') ? '沟通' : allowedStages[0]);
  const closeSel = sel([['成交', t('won')], ['关闭', t('closed')]], '成交');
  const actionSel = sel([['', t('opp_no_action_link')]], '');
  const actionNote = h('div', { class: 'sheet-note' }, t('opp_action_loading'));
  const resultTa = h('textarea', { class: 'sheet-textarea', placeholder: t('outcome_required') });
  const form = h('div', {}, [
    fieldRow(t('operation'), modeSel),
    h('div', { id: 'opp-stage-wrap' }, [fieldRow(t('advance_to'), stageSel,
      `${t('current_stage')}${stageLabel(status)}；${t('no_auto_advance')}`)]),
    h('div', { id: 'opp-close-wrap', style: 'display:none' }, [
      fieldRow(t('result'), closeSel),
      fieldRow(t('result_note'), resultTa, t('close_check_note')),
      fieldRow(t('opp_action_link'), h('div', {}, [actionSel, actionNote]), t('opp_action_link_note')),
    ]),
  ]);
  const sheet = openSheet({
    title: t('advance_close_opp'),
    sub: `${oppTypeLabel(opportunity.opportunity_type) || opportunity.opportunity_type || t('opportunity')} · ${personName || ''}`,
    body: h('div', {}, [
      h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('preview_before_write')),
      form,
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doPreview(e.currentTarget) }, t('generate_preview')),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
  data.opportunityDetails(ctx, opportunity.id).then((res) => {
    const actions = Array.isArray(res.actions) ? res.actions.filter((action) =>
      String(action.opportunity_id || '') === String(opportunity.id)) : [];
    actions.forEach((action) => actionSel.appendChild(h('option', { value: String(action.id) },
      `${action.title || t('opp_action_untitled')} · ${translateEnum('work_status', action.status) || action.status || ''}`)));
    actionNote.textContent = actions.length ? t('opp_action_link_ready') : t('opp_action_none');
  }).catch(() => { actionNote.textContent = t('opp_action_unavailable'); });
  modeSel.onchange = () => {
    form.querySelector('#opp-stage-wrap').style.display = modeSel.value === 'stage' ? '' : 'none';
    form.querySelector('#opp-close-wrap').style.display = modeSel.value === 'close' ? '' : 'none';
  };
  async function doPreview(btn) {
    sheet.showErr('');
    busy(btn, true, t('previewing'));
    const draft = modeSel.value === 'stage' ? { status: stageSel.value }
      : { actionId: actionSel.value ? Number(actionSel.value) : null, status: closeSel.value, result: resultTa.value.trim() };
    try {
      if (modeSel.value === 'close' && !draft.result) throw new Error(t('fill_outcome'));
      const res = await p360(ctx, 'previewOpportunity', { data: {
        idempotencyKey: uuid(), operation: modeSel.value,
        personId: String(opportunity.person_id || opportunity.person?.id || ''),
        opportunityId: String(opportunity.id), draft,
      } });
      renderConfirm(res, draft);
    } catch (err) { busy(btn, false, t('generate_preview')); sheet.showErr(err.message); }
  }
  function renderConfirm(res, draft) {
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow(t('target'), (res.preview && res.preview.personName) || personName || ''),
        kvRow(t('content'), `${oppTypeLabel(opportunity.opportunity_type) || t('opportunity')}（${stageLabel(status)}）`),
        h('div', { class: 'kv-line' }, [
          h('span', { class: 'kv-k' }, t('change')),
          bdg(stageLabel(status), 'gray'), h('span', {}, ' → '),
          bdg(stageLabel(draft.status) || draft.status, draft.status === '成交' ? 'jade' : 'gold'),
        ]),
        draft.result ? kvRow(t('result_note'), draft.result.slice(0, 120)) : null,
        h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('preview_no_write')),
      ]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            busy(btn, true, t('writing'));
            try {
              await p360(ctx, 'executeOpportunity', { previewId: res.previewId });
              sheet.overlay.remove();
              ctx.toast(draft.status === '成交' ? t('opp_won') : t('opp_updated'), 'ok');
              if (onDone) onDone();
            } catch (err) { busy(btn, false, t('confirm_execute')); sheet.showErr(err.message); }
          },
        }, t('confirm_execute')),
      ]),
    ]));
  }
}

// ---------- 机会：编辑 Person-only opportunity ----------
export function openOpportunityEdit(ctx, { opportunity, personName, onDone }) {
  const typeSel = sel(OPP_TYPES.map((key) => [key, oppTypeLabel(key)]), opportunity.opportunity_type);
  const progressTa = h('textarea', { class: 'sheet-textarea' }, opportunity.last_progress || '');
  const nextInput = h('input', { class: 'sheet-input', value: opportunity.next_action || '' });
  const dateInput = h('input', { class: 'sheet-input', type: 'date', value: opportunity.next_action_date || '' });
  const sheet = openSheet({
    title: t('opp_edit_title'),
    sub: `${oppTypeLabel(opportunity.opportunity_type) || opportunity.opportunity_type || t('opportunity')} · ${personName || ''}`,
    body: h('div', {}, [
      h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('preview_before_write')),
      fieldRow(t('opp_type'), typeSel),
      fieldRow(t('current_progress'), progressTa),
      fieldRow(t('next_step'), nextInput),
      fieldRow(t('next_date'), dateInput, t('date_optional')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doPreview(e.currentTarget) }, t('generate_preview')),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
  async function doPreview(btn) {
    sheet.showErr('');
    if (!progressTa.value.trim()) { sheet.showErr(t('fill_progress')); return; }
    if (!nextInput.value.trim()) { sheet.showErr(t('fill_next_step')); return; }
    busy(btn, true, t('previewing'));
    const draft = { type:typeSel.value,progress:progressTa.value.trim(),nextAction:nextInput.value.trim(),
      nextActionDate:dateInput.value || null };
    try {
      const res = await p360(ctx, 'previewOpportunity', { data: {
        idempotencyKey: uuid(), operation: 'edit', personId: String(opportunity.person_id || opportunity.person?.id || ''),
        opportunityId: String(opportunity.id), draft,
      } });
      const preview = res.preview || {};
      sheet.swap(h('div', {}, [
        previewBlock([
          kvRow(t('target'), (preview.personName || personName || '')),
          kvRow(t('opp_type'), `${oppTypeLabel(opportunity.opportunity_type) || opportunity.opportunity_type} → ${oppTypeLabel(draft.type)}`),
          kvRow(t('current_progress'), draft.progress.slice(0, 180)),
          kvRow(t('next_step'), `${draft.nextAction}${draft.nextActionDate ? ' · ' + draft.nextActionDate : ''}`),
          h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('preview_no_write')),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
            const confirmBtn = e.currentTarget;
            busy(confirmBtn, true, t('writing'));
            try {
              await p360(ctx, 'executeOpportunity', { previewId: res.previewId });
              sheet.overlay.remove();
              ctx.toast(t('opp_updated'), 'ok');
              if (onDone) onDone();
            } catch (err) { busy(confirmBtn, false, t('confirm_execute')); sheet.showErr(err.message); }
          } }, t('confirm_execute')),
        ]),
      ]));
    } catch (err) { busy(btn, false, t('generate_preview')); sheet.showErr(err.message); }
  }
}

// ---------- 机会：新建 ----------
export function openOpportunityCreate(ctx, { onDone }) {
  const nameInput = h('input', { class: 'sheet-input', placeholder: t('search_person') });
  const searchBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => doSearch() }, t('search_person'));
  const candBox = h('div', {});
  const typeSel = sel(OPP_TYPES.map((k) => [k, oppTypeLabel(k)]), 'insurance');
  const progressTa = h('textarea', { class: 'sheet-textarea', placeholder: t('placeholder_progress') });
  const nextInput = h('input', { class: 'sheet-input', placeholder: t('placeholder_next_action') });
  const dateInput = h('input', { class: 'sheet-input', type: 'date' });
  let picked = null;
  const sheet = openSheet({
    title: t('new_opp'), sub: t('new_opp_sub'),
    body: h('div', {}, [
      fieldRow(t('link_person'), h('div', { style: 'display:flex;gap:8px' }, [nameInput, searchBtn])),
      candBox,
      fieldRow(t('opp_type'), typeSel),
      fieldRow(t('current_progress'), progressTa),
      fieldRow(t('next_step'), nextInput),
      fieldRow(t('next_date'), dateInput, t('date_optional')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doPreview(e.currentTarget) }, t('generate_preview')),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
  async function doSearch() {
    const name = nameInput.value.trim();
    candBox.replaceChildren(h('div', { class: 'sheet-note' }, t('searching')));
    if (!name) { candBox.replaceChildren(h('div', { class: 'sheet-note' }, t('enter_name'))); return; }
    try {
      const res = await p360(ctx, 'search', { name });
      const rows = res.candidates || [];
      if (!rows.length) { candBox.replaceChildren(h('div', { class: 'sheet-err' }, t('no_person_found'))); return; }
      picked = rows.length === 1 ? rows[0] : null;
      candBox.replaceChildren(rows.map((c) => h('div', {
        class: 'cand' + (rows.length === 1 ? ' active' : ''),
        onclick: (e) => {
          picked = c;
          candBox.querySelectorAll('.cand').forEach((n) => n.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }, `${c.display_name || c.displayName}（${c.occupation || t('occupation_empty')} · ${c.organization || t('organization_empty')}）#${c.id}`)),
      h('div', { class: 'sheet-note', style: 'margin-top:6px' },
        rows.length === 1 ? t('auto_selected') : t('select_person')));
    } catch (err) { candBox.replaceChildren(h('div', { class: 'sheet-err' }, err.message)); }
  }
  async function doPreview(btn) {
    sheet.showErr('');
    if (!picked) { sheet.showErr(t('select_person_first')); return; }
    if (!progressTa.value.trim()) { sheet.showErr(t('fill_progress')); return; }
    if (!nextInput.value.trim()) { sheet.showErr(t('fill_next_step')); return; }
    busy(btn, true, t('previewing'));
    try {
      const res = await p360(ctx, 'previewOpportunity', { data: {
        idempotencyKey: uuid(), operation: 'create',
        personId: String(picked.id), opportunityId: null,
        draft: {
          type: typeSel.value, progress: progressTa.value.trim(),
          nextAction: nextInput.value.trim(),
          nextActionDate: dateInput.value || null,
        },
      } });
      sheet.swap(h('div', {}, [
        previewBlock([
          kvRow(t('target'), `${picked.display_name || picked.displayName} #${picked.id}`),
          kvRow(t('type'), oppTypeLabel(typeSel.value)),
          kvRow(t('progress'), progressTa.value.trim().slice(0, 120)),
          kvRow(t('next_action_label'), `${nextInput.value.trim()}${dateInput.value ? ' · ' + dateInput.value : ''}`),
          h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('new_opp_stage')),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: async (e) => {
              const b = e.currentTarget;
              busy(b, true, t('writing'));
              try {
                await p360(ctx, 'executeOpportunity', { previewId: res.previewId });
                sheet.overlay.remove();
                ctx.toast(t('opp_created'), 'ok');
                if (onDone) onDone();
              } catch (err) { busy(b, false, t('confirm_create')); sheet.showErr(err.message); }
            },
          }, t('confirm_create')),
        ]),
      ]));
    } catch (err) { busy(btn, false, t('generate_preview')); sheet.showErr(err.message); }
  }
}

// ---------- 机会候选：三键（编辑 / 拒绝 / 接受并建机会） ----------
export function openCandidate(ctx, { row, onDone }) {
  const body = h('div', {}, [h('div', { class: 'sheet-note' }, t('preview_generating'))]);
  const sheet = openSheet({
    title: t('review_candidate'),
    sub: `${row.personName || ''} · ${t('candidate_id_prefix')}${row.id}`,
    body,
  });
  document.body.appendChild(sheet.overlay);
  let pv = null;
  let hash = null;
  let typeSel; let reasonTa; let nextTa;
  (async () => {
    const res = await assistant(ctx, { action: 'opportunityCandidate', operation: 'preview', candidateId: row.id });
    pv = res.preview || {};
    hash = res.previewHash || null;
    renderEditor(pv, res.expiresAt);
  })().catch((err) => sheet.swap(h('div', { class: 'sheet-err' }, err.message)));

  function renderEditor(preview, expiresAt) {
    const d = preview.after || {};
    typeSel = sel(OPP_TYPES.map((k) => [k, oppTypeLabel(k)]), d.opportunity_type || 'insurance');
    reasonTa = h('textarea', { class: 'sheet-textarea' }, d.reason || '');
    nextTa = h('textarea', { class: 'sheet-textarea' }, d.next_action || '');
    const evidence = preview.evidence || [];
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow(t('target'), (preview.person && `${preview.person.displayName} #${preview.person.id}`) || row.personName || ''),
        h('div', { class: 'sheet-note', style: 'margin-top:6px' }, t('ai_candidate_note')),
      ]),
      fieldRow(t('opp_type'), typeSel),
      fieldRow(t('reason_basis'), reasonTa),
      fieldRow(t('suggested_next'), nextTa),
      evidence.length ? h('div', { class: 'sheet-field' }, [
        h('label', {}, t('evidence_quote')),
        h('ul', { class: 'sheet-evidence' }, evidence.slice(0, 6).map((x) => h('li', {}, String(x)))),
      ]) : null,
      expiresAt ? h('div', { class: 'sheet-note' }, `${t('preview_valid_until')} ${fmtDate(String(expiresAt).slice(0, 10))}；${t('draft_changed_preview')}`) : null,
      h('div', { class: 'sheet-actions' }, [
        h('button', {
          class: 'btn btn-ghost', type: 'button', style: 'color:var(--red)',
          onclick: async (e) => {
            const b = e.currentTarget;
            busy(b, true, '…');
            try {
              await assistant(ctx, { action: 'opportunityCandidate', operation: 'reject', candidateId: row.id });
              sheet.overlay.remove();
              ctx.toast(t('candidate_rejected'), 'ok');
              if (onDone) onDone();
            } catch (err) { busy(b, false, t('reject')); sheet.showErr(err.message); }
          },
        }, t('reject')),
        h('button', {
          class: 'btn btn-ghost', type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            busy(b, true, '…');
            try {
              await assistant(ctx, { action: 'opportunityCandidate', operation: 'edit', candidateId: row.id,
                draft: { opportunity_type: typeSel.value, reason: reasonTa.value.trim(), next_action: nextTa.value.trim() } });
              const re = await assistant(ctx, { action: 'opportunityCandidate', operation: 'preview', candidateId: row.id });
              pv = re.preview || {}; hash = re.previewHash || null;
              busy(b, false, t('save_edit'));
              ctx.toast(t('draft_updated'), 'ok');
            } catch (err) { busy(b, false, t('save_edit')); sheet.showErr(err.message); }
          },
        }, t('save_edit')),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            busy(b, true, '…');
            try {
              const dirty = !hash ||
                typeSel.value !== (pv.after && pv.after.opportunity_type) ||
                reasonTa.value.trim() !== (pv.after && pv.after.reason) ||
                nextTa.value.trim() !== (pv.after && pv.after.next_action);
              if (dirty) {
                await assistant(ctx, { action: 'opportunityCandidate', operation: 'edit', candidateId: row.id,
                  draft: { opportunity_type: typeSel.value, reason: reasonTa.value.trim(), next_action: nextTa.value.trim() } });
                const re = await assistant(ctx, { action: 'opportunityCandidate', operation: 'preview', candidateId: row.id });
                pv = re.preview || {}; hash = re.previewHash || null;
                busy(b, false, t('accept_create'));
                sheet.showErr(t('draft_modified'));
                return;
              }
              await assistant(ctx, { action: 'opportunityCandidate', operation: 'confirm', candidateId: row.id, previewHash: hash });
              const done = await assistant(ctx, { action: 'opportunityCandidate', operation: 'execute', candidateId: row.id });
              sheet.overlay.remove();
              ctx.toast(done && done.opportunityId ? `${t('opp_created')} #${done.opportunityId}` : t('opp_created'), 'ok');
              if (onDone) onDone();
            } catch (err) { busy(b, false, t('accept_create')); sheet.showErr(err.message); }
          },
        }, t('accept_create')),
      ]),
    ]));
  }
}

// ---------- 快速记录（Quick Capture，生产链路） ----------
export function openQuickCapture(ctx, { personId, onDone } = {}) {
  async function parseFocused(text, selected = null) {
    let workContext = {};
    if (selected) {
      const [work, context] = await Promise.all([
        p360(ctx, 'listPersonWorkItems', { personId: String(selected.id) }),
        p360(ctx, 'getContextGroups', { personId: String(selected.id) }),
      ]);
      if (!work || String(work.personId) !== String(selected.id) || !Array.isArray(work.rows) ||
          !Array.isArray(context?.groups?.fact)) {
        throw new Error(t('capture_history_failed'));
      }
      const open = work.rows.filter(row => String(row.person_id) === String(selected.id) &&
        (row.status === 'open' || row.kind === 'action' && row.status === 'in_progress'));
      const actions = open.filter(row => row.kind === 'action');
      const commitments = open.filter(row => row.kind === 'commitment');
      workContext = {
        memories: context.groups.fact.filter(row => String(row.personId) === String(selected.id) &&
          row.confirmed === true && row.validity === 'current').slice(0, 50).map(row => ({
          id: String(row.id), person_id: String(selected.id), content: String(row.content || '').slice(0, 500),
          confirmed: true, valid_from: row.validFrom, valid_to: row.validTo, needsReview: row.needsReview === true,
        })),
        workItems: [...actions.slice(0, 30), ...commitments.slice(0, 30)],
        workItemsLimited: work.hasMore === true || actions.length > 30 || commitments.length > 30 ||
          context.groups.fact.length >= 50,
      };
    }
    return aiParse(ctx, { action: 'quick_capture', profile: 'focused', text, language: getLang(),
      ...(selected ? { personId: String(selected.id), selectedName: selected.displayName || selected.display_name,
        ...workContext } : {}) });
  }
  const ta = h('textarea', {
    class: 'sheet-textarea', style: 'min-height:96px', maxlength: 10000,
    placeholder: t('quick_capture_placeholder'),
  });
  const parseBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doParse(e.currentTarget) }, t('ai_parse'));
  const sheet = openSheet({
    title: t('quick_record'),
    sub: t('capture_focus_intro'),
    body: h('div', {}, [ta, h('div', { class: 'sheet-actions' }, [parseBtn])]),
  });
  document.body.appendChild(sheet.overlay);
  async function doParse(btn) {
    const text = ta.value.trim();
    if (!text) { sheet.showErr(t('enter_content')); return; }
    busy(btn, true, t('ai_parsing'));
    try {
      let selected = null;
      if (personId) {
        const home = await p360(ctx, 'get', { personId: String(personId) });
        if (home?.person?.display_name) selected = { id: String(personId), displayName: home.person.display_name };
      }
      const r = await parseFocused(text, selected);
      busy(btn, false, t('ai_parse'));
      await renderReview(r, text, btn, selected);
    } catch (err) {
      busy(btn, false, t('ai_parse'));
      sheet.showErr(`${t('ai_parse_failed')}${err.message}`);
    }
  }
  async function renderReview(r, text, parseBtn, reviewedPerson = null) {
    const p = r.parsed || {};
    // 服务端解析 canonical Person 候选（规则 14）：锁人直接复用；否则按 AI 识别的姓名解析。
    let fixed = null;
    if (personId) {
      const home = await p360(ctx, 'get', { personId: String(personId) });
      const name = home && home.person && home.person.display_name;
      if (name) fixed = { id: String(personId), displayName: name };
    }
    const resolvedName = reviewedPerson?.displayName || reviewedPerson?.display_name || p.person_name;
    const resolution = fixed ? null
      : (resolvedName ? await p360(ctx, 'resolveQuickCaptureName', { name: resolvedName }) : null);
    const candidates = fixed ? [fixed] : ((resolution && resolution.candidates) || []);
    // 服务端允许无同名或带限定无匹配时人工确认新建 Person（同名候选只有一人时也适用）；
    // AI 未识别人名时也允许手动填写姓名，保存前先做同名解析。
    const canCreate = !fixed && (!resolution ||
      (!resolution.hasMore && !resolution.deletedIdentity &&
        (['available', 'confirm_new_qualified'].includes(resolution.status) ||
          resolution.canCreateAfterConfirmation === true)));
    const hint = fixed ? t('person_locked')
      : !p.person_name ? t('ai_no_name')
      : canCreate ? (candidates.length ? t('identity_confirm_new') : t('no_same_name'))
      : candidates.length ? t('select_confirmed') : t('many_names');
    const candBox = h('div', {});
    let picked = reviewedPerson || fixed || null;
    let refining = false;
    const markActive = (node) => {
      candBox.querySelectorAll('.cand').forEach((n) => n.classList.remove('active'));
      node.classList.add('active');
    };
    candidates.forEach((c) => {
      candBox.appendChild(h('div', {
        class: 'cand' + (picked && String(picked.id) === String(c.id) ? ' active' : ''),
        onclick: async (e) => {
          if (refining) return;
          picked = c; markActive(e.currentTarget);
          if (!p.focused || (reviewedPerson && String(reviewedPerson.id) === String(c.id))) return;
          refining = true;
          const controls = [...sheetBody.querySelectorAll('button,input,textarea,select')];
          controls.forEach(control => { control.disabled = true; });
          status.textContent = t('capture_checking_history');
          try {
            const refined = await parseFocused(text, c);
            await renderReview(refined, text, parseBtn, c);
          } catch (error) {
            // Failed history review must not silently claim deduplication succeeded.
            picked = null;
            controls.forEach(control => { control.disabled = false; });
            status.textContent = t('capture_history_failed');
            sheet.showErr(error.message);
          } finally { refining = false; }
        },
      }, `${c.displayName || c.display_name}（${c.occupation || t('occupation_empty')} · ${c.organization || t('organization_empty')}）#${c.id}`));
    });
    if (canCreate) {
      const newNameInput = h('input', {
        class: 'sheet-input', value: (resolution && resolution.displayName) || p.person_name || '',
        maxlength: '160', placeholder: t('new_person_name_ph'),
      });
      const newCard = h('div', { class: 'cand', style: 'display:flex;flex-direction:column;align-items:stretch;gap:6px;cursor:default' }, [
        h('div', { style: 'font-weight:700' }, t('new_person_manual')),
        newNameInput,
        h('div', { class: 'sheet-note' }, t('test_account_note')),
      ]);
      const selectNew = () => { picked = { isNew: true }; markActive(newCard); };
      newNameInput.addEventListener('focus', selectNew);
      newNameInput.addEventListener('input', selectNew);
      candBox.appendChild(newCard);
    }
    if (!candidates.length && !canCreate) {
      candBox.appendChild(h('div', { class: 'sheet-err' }, hint));
    }
    const INTERACTION_TYPES = ['见面', '吃饭', '电话', '微信', '活动', '其他'];
    const typeSel = sel(INTERACTION_TYPES.map((v) => [v, t('interaction_type_' + (v === '见面' ? 'meet' : v === '吃饭' ? 'meal' : v === '电话' ? 'call' : v === '微信' ? 'wechat' : v === '活动' ? 'activity' : 'other'))]), p.interaction_type || '见面');
    const dateInput = h('input', { class: 'sheet-input', type: 'date', value: p.interaction_date || todayStr() });
    const factList = [];
    const pushFacts = (arr) => (arr || []).forEach((x) => { if (x && String(x).trim()) factList.push(String(x).trim()); });
    pushFacts(p.facts); pushFacts(p.needs); pushFacts(p.interests);
    if (!factList.length) factList.push('');
    const sigList = [];
    const pushSig = (note) => { if (note && String(note).trim()) sigList.push(String(note).trim()); };
    if (p.opportunity && p.opportunity.has) pushSig(`${t('opportunity')}：${p.opportunity.type || ''} ${p.opportunity.note || ''}`);
    if (p.recruit_signal && p.recruit_signal.has) pushSig(`${t('recruit')}：${p.recruit_signal.note || ''}`);
    if (p.referral_signal && p.referral_signal.has) pushSig(`${t('opp_type_referral')}：${p.referral_signal.note || ''}`);
    if (!sigList.length) sigList.push('');
    const factsWrap = listEditor(factList, t('capture_memories'), t('capture_memory_hint'));
    const sigsWrap = listEditor(sigList, t('signals_label'), t('max_12_signals'));
    const summaryTa = h('textarea', { class: 'sheet-textarea' },
      p.summary || (p.facts || []).join('；') || '');
    const status = h('p', { class: 'sheet-note', role: 'status' },
      p.contextChecked ? t(p.contextLimited ? 'capture_history_limited' : 'capture_history_checked') : t('capture_history_hint'));
    const recordOnly = h('input', { type: 'checkbox', 'data-capture-record-only': 'true',
      onchange: () => {
        extras.hidden = recordOnly.checked;
        nextReview.hidden = recordOnly.checked;
      } });
    const memoryNotes = (p.memories || []).map(memory => h('div', { class: 'sheet-note' },
      `${memory.change ? t('capture_changed_memory') + ' ' : ''}${t('capture_evidence')}${memory.evidence}`));
    const extras = h('div', {}, [factsWrap, ...memoryNotes]);
    // Compatibility responses retain their separate signal editor; focused drafts never promote guesses to facts.
    if (!p.focused) extras.appendChild(sigsWrap);
    const nextItems = [...(p.commitments || []), ...(p.suggestions || [])];
    const nextReview = h('div', { class: 'sheet-field' }, [
      h('label', {}, t('capture_next_steps')),
      h('div', { class: 'sheet-note' }, t('capture_next_hint')),
      ...(nextItems.length ? nextItems.map(item => h('div', { class: 'sheet-note', style: 'margin-top:8px' }, [
        h('strong', {}, `${t(item.kind === 'commitment' ? 'capture_promise' : 'capture_suggestion')} · ${item.title}`),
        h('div', {}, `${item.date || t('capture_date_unknown')} · ${item.method || item.evidence || ''}`),
        item.reason ? h('div', {}, item.reason) : null,
        item.existing ? h('div', {}, `${t('capture_existing_task')} #${item.existing.id}`) : null,
      ])) : [h('div', { class: 'sheet-note' }, t('capture_no_next'))]),
    ]);
    function afterSave(savedPersonId, savedName) {
      ctx.toast(t('interaction_saved'), 'ok');
      if (onDone) onDone();
      if (recordOnly.checked || !nextItems.length) { sheet.overlay.remove(); return; }
      sheet.swap(h('div', {}, [
        h('p', { class: 'sheet-note' }, t('capture_saved_next')),
        ...nextItems.map(item => {
          const button = h('button', { class: 'btn btn-soft', type: 'button', onclick: () => {
            openWorkItemEditor(ctx, {
              kind: item.existing?.kind || item.kind, row: item.existing || null,
              personId: String(savedPersonId), personName: savedName,
              initialTitle: item.title,
              initialDescription: [item.reason, item.method, item.evidence].filter(Boolean).join('\n'),
              // Date-only suggestions remain visible; the person chooses an actual reminder time.
              initialCommitmentType: item.commitmentType || '',
              onDone: () => { button.disabled = true; button.textContent = t('work_item_saved'); if (onDone) onDone(); },
            });
          } }, t(item.existing ? 'capture_review_existing' : 'capture_prepare_task'));
          return h('div', { class: 'sheet-field' }, [
            h('strong', {}, item.title),
            h('p', { class: 'sheet-note' }, `${item.date || t('capture_date_unknown')} · ${item.method || item.evidence || ''}`),
            button,
          ]);
        }),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('capture_done')),
        ]),
      ]));
    }
    let newCaptureKey = '';
    let newCaptureShape = '';
    let existingCaptureKey = '';
    let existingCaptureShape = '';
    const sheetBody = h('div', {}, [
      fieldRow(t('link_person'), candBox, hint),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('method')), typeSel]),
        h('div', { class: 'sheet-field', style: 'width:170px' }, [h('label', {}, t('date')), dateInput]),
      ]),
      fieldRow(t('interaction_summary'), summaryTa, t('capture_summary_hint')),
      h('label', { class: 'sheet-note', style: 'display:flex;gap:8px;align-items:center;margin:12px 0' },
        [recordOnly, t('capture_record_only')]),
      status,
      extras,
      nextReview,
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            if (refining) return;
            if (!picked) { sheet.showErr(t('select_person_first')); return; }
            const facts = recordOnly.checked ? [] : [...new Set(factsWrap.readValues().filter((x) => x.trim()))];
            const signals = recordOnly.checked || p.focused ? [] : sigsWrap.readValues().filter((x) => x.trim());
            if (facts.length > 20 || signals.length > 12) { sheet.showErr(t('max_20_items')); return; }
            if (facts.some((x) => x.length > 500) || signals.some((x) => x.length > 500)) {
              sheet.showErr(t('max_500_chars')); return;
            }
            const summary = (summaryTa.value || facts.join('；') || text).slice(0, 2000);
            if (!summary.trim()) { sheet.showErr(t('fill_summary_or_fact')); return; }
            busy(b, true, t('saving'));
            try {
              if (picked.isNew) {
                // 新建分支：姓名可能被改过（或 AI 未识别人名）→ 先重新解析同名；再走 Person 建档预览。
                let res = resolution;
                const newNameInputEl = candBox.querySelector('.cand input');
                const newName = (newNameInputEl ? newNameInputEl.value : '').trim();
                if (!newName) { busy(b, false, t('confirm_save')); sheet.showErr(t('enter_new_person_name')); return; }
                if (!res || newName !== res.displayName) {
                  res = await p360(ctx, 'resolveQuickCaptureName', { name: newName });
                  if (res.hasMore || res.deletedIdentity ||
                      !(['available', 'confirm_new_qualified'].includes(res.status) ||
                        res.canCreateAfterConfirmation === true)) {
                    busy(b, false, t('confirm_save'));
                    sheet.showErr(t('same_name_exists')); return;
                  }
                }
                const captureData = {
                  kind: 'capture_v2_new', displayName: res.displayName, nameKey: res.nameKey,
                  interaction: {
                    type: typeSel.value, at: dateToIso(dateInput.value || todayStr()), channel: '',
                    summary, rawNote: text,
                  },
                  facts, signals,
                };
                const shape = JSON.stringify(captureData);
                if (shape !== newCaptureShape) { newCaptureShape = shape; newCaptureKey = uuid(); }
                const pv = await p360(ctx, 'previewIdentity', { data: {
                  ...captureData, idempotencyKey: newCaptureKey,
                } });
                const verified = pv && pv.preview;
                if (!verified || verified.kind !== 'capture_v2_new' || !verified.newPerson ||
                    !verified.interaction || !Array.isArray(verified.facts) || !Array.isArray(verified.signals)) {
                  throw new Error(t('capture_preview_invalid'));
                }
                busy(b, false, t('confirm_save'));
                sheet.swap(h('div', {}, [
                  previewBlock([
                    kvRow(t('step1_new_person'), verified.displayName),
                    kvRow(t('step2_interaction'), `${t('interaction_type_' + (verified.interaction.type === '见面' ? 'meet' : verified.interaction.type === '吃饭' ? 'meal' : verified.interaction.type === '电话' ? 'call' : verified.interaction.type === '微信' ? 'wechat' : verified.interaction.type === '活动' ? 'activity' : 'other'))} · ${verified.interaction.at}`),
                    kvRow(t('interaction_summary'), verified.interaction.summary),
                    kvRow(t('capture_original_note'), verified.interaction.rawNote),
                    kvRow(t('facts_label'), verified.facts.join('；')),
                    kvRow(t('signals_label'), verified.signals.join('；')),
                    kvRow(t('capture_preview_expires'), pv.expiresAt || ''),
                    h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('capture_atomic_note')),
                  ]),
                  h('div', { class: 'sheet-actions' }, [
                    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
                    h('button', {
                      class: 'btn btn-primary', type: 'button',
                      onclick: async (ev) => {
                        const bb = ev.currentTarget;
                        busy(bb, true, t('creating_saving'));
                        try {
                          const created = await p360(ctx, 'executeIdentity', { data: { previewId: pv.previewId } });
                          if (!created || !created.personId || !created.interactionId) throw new Error(t('create_failed'));
                          afterSave(created.personId, verified.displayName);
                        } catch (err) { busy(bb, false, t('confirm_create_save')); sheet.showErr(err.message); }
                      },
                    }, t('confirm_create_save')),
                  ]),
                ]));
                return;
              }
              const captureData = {
                kind: 'capture_v2_existing', personId: String(picked.id),
                displayName: picked.displayName || picked.display_name,
                interaction: {
                  type: typeSel.value, at: dateToIso(dateInput.value || todayStr()), channel: '',
                  summary, rawNote: text,
                }, facts, signals,
              };
              const shape = JSON.stringify(captureData);
              if (shape !== existingCaptureShape) { existingCaptureShape = shape; existingCaptureKey = uuid(); }
              const pv = await p360(ctx, 'previewIdentity', { data: {
                ...captureData, idempotencyKey: existingCaptureKey,
              } });
              const verified = pv && pv.preview;
              if (!verified || verified.kind !== 'capture_v2_existing' || verified.newPerson ||
                  String(verified.personId) !== String(picked.id) || !verified.interaction ||
                  !Array.isArray(verified.facts) || !Array.isArray(verified.signals)) {
                throw new Error(t('capture_preview_invalid'));
              }
              busy(b, false, t('confirm_save'));
              sheet.swap(h('div', {}, [
                previewBlock([
                  kvRow(t('link_person'), `${verified.displayName} #${verified.personId}`),
                  kvRow(t('step2_interaction'), `${t('interaction_type_' + (verified.interaction.type === '见面' ? 'meet' : verified.interaction.type === '吃饭' ? 'meal' : verified.interaction.type === '电话' ? 'call' : verified.interaction.type === '微信' ? 'wechat' : verified.interaction.type === '活动' ? 'activity' : 'other'))} · ${verified.interaction.at}`),
                  kvRow(t('interaction_summary'), verified.interaction.summary),
                  kvRow(t('capture_original_note'), verified.interaction.rawNote),
                  kvRow(t('facts_label'), verified.facts.join('；')),
                  kvRow(t('signals_label'), verified.signals.join('；')),
                  kvRow(t('capture_preview_expires'), pv.expiresAt || ''),
                  h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('capture_existing_atomic_note')),
                ]),
                h('div', { class: 'sheet-actions' }, [
                  h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
                  h('button', { class: 'btn btn-primary', type: 'button',
                    onclick: async (ev) => {
                      const bb = ev.currentTarget;
                      busy(bb, true, t('saving'));
                      try {
                        const saved = await p360(ctx, 'executeIdentity', { data: { previewId: pv.previewId } });
                        if (!saved || !saved.interactionId || String(saved.personId) !== String(picked.id)) {
                          throw new Error(t('save_failed'));
                        }
                        afterSave(saved.personId, verified.displayName);
                      } catch (err) { busy(bb, false, t('confirm_save')); sheet.showErr(err.message); }
                    },
                  }, t('confirm_save')),
                ]),
              ]));
            } catch (err) {
              busy(b, false, t('confirm_save'));
              sheet.showErr(String(err.message || '').includes('Selected Person')
                ? t('person_changed') : err.message);
            }
          },
        }, t('confirm_save')),
      ]),
    ]);
    sheet.swap(sheetBody);
    parseBtn && (parseBtn.disabled = false);
  }
  function listEditor(initial, label, note) {
    const wrap = h('div', { class: 'sheet-field' });
    const rowsEl = h('div', {});
    function addRow(value) {
      const rowEl = h('div', { class: 'sheet-item-row' }, [
        h('textarea', { class: 'sheet-textarea', style: 'min-height:44px;flex:1' }, value || ''),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': t('delete_aria'),
          onclick: () => { rowEl.remove(); if (!rowsEl.children.length) addRow(''); },
        }, [ic('x')]),
      ]);
      rowsEl.appendChild(rowEl);
    }
    initial.forEach((v) => addRow(v));
    const addBtn = h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:6px',
      onclick: () => addRow(''),
    }, [ic('plus'), t('add_one')]);
    wrap.appendChild(h('label', {}, label));
    wrap.appendChild(rowsEl);
    wrap.appendChild(addBtn);
    if (note) wrap.appendChild(h('div', { class: 'sheet-note', style: 'margin-top:4px' }, note));
    wrap.readValues = () => Array.from(rowsEl.querySelectorAll('textarea')).map((t) => t.value.trim());
    return wrap;
  }
}

// ---------- 人物：新建（resolveIdentity 服务端同名解析 → 人工确认 → previewIdentity → executeIdentity） ----------
export function openPersonNew(ctx, { onDone } = {}) {
  const nameInput = h('input', { class: 'sheet-input', maxlength: '160', placeholder: t('new_person_name_ph') });
  const checkBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doResolve(e.currentTarget) }, t('btn_check_name'));
  const sheet = openSheet({
    title: t('new_person_title'), sub: t('new_person_sub'),
    body: h('div', {}, [
      fieldRow(t('new_person_name'), nameInput),
      h('div', { class: 'sheet-actions' }, [checkBtn]),
    ]),
  });
  document.body.appendChild(sheet.overlay);

  async function doResolve(btn) {
    const name = nameInput.value.trim();
    if (!name) { sheet.showErr(t('enter_new_person_name')); return; }
    busy(btn, true, t('new_person_checking'));
    try {
      const res = await p360(ctx, 'resolveIdentity', { name });
      busy(btn, false, t('btn_check_name'));
      render(res, name);
    } catch (err) {
      busy(btn, false, t('btn_check_name'));
      sheet.showErr(err.message);
    }
  }

  function render(res, name) {
    const candidates = res.candidates || [];
    // 服务端契约（previewIdentity 同口径）：仅在无同名过多、无回收站同名且可人工确认时允许新建
    const canCreate = !res.hasMore && !res.deletedIdentity &&
      (['available', 'confirm_new_qualified'].includes(res.status) ||
        res.canCreateAfterConfirmation === true);
    const rows = [];
    if (candidates.length) {
      rows.push(h('p', { class: 'sheet-note', style: 'margin:0 0 8px' },
        canCreate ? t('identity_confirm_new') :
          `${t('identity_pick_existing')} ${t('identity_qualifier_hint')}`));
      candidates.forEach((c) => {
        const cName = c.displayName || c.display_name;
        const link = h('a', {
          class: 'cand', href: `#/person/${c.id}`,
          onclick: () => sheet.overlay.remove(),
        }, `${cName}（${c.occupation || t('occupation_empty')} · ${c.organization || t('organization_empty')}）#${c.id}`);
        const editBtn = h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: (e) => {
            e.preventDefault(); e.stopPropagation();
            openPersonEdit(ctx, { personId: c.id, onDone: () => doResolve(checkBtn) });
          },
        }, t('btn_edit'));
        const delBtn = h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', style: 'color:var(--red)',
          onclick: (e) => {
            e.preventDefault(); e.stopPropagation();
            openPersonDelete(ctx, { personId: c.id, displayName: cName, onDone: () => doResolve(checkBtn) });
          },
        }, t('btn_delete'));
        rows.push(h('div', { class: 'cand-wrap' }, [link, h('div', { class: 'cand-ops' }, [editBtn, delBtn])]));
      });
    } else if (res.hasMore) {
      rows.push(h('div', { class: 'sheet-err' }, t('identity_has_more')));
    } else if (res.deletedIdentity) {
      rows.push(h('div', { class: 'sheet-err' }, t('identity_deleted_note')));
    } else {
      rows.push(h('p', { class: 'sheet-note', style: 'margin:0 0 8px' },
        res.status === 'available' ? t('identity_available') : t('identity_confirm_new')));
    }
    if (canCreate) {
      rows.push(h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => previewCreate(e.currentTarget, name) }, t('btn_create')),
      ]));
    }
    sheet.swap(h('div', {}, [
      fieldRow(t('new_person_name'), nameInput),
      h('div', { style: 'margin-top:8px' }, rows),
    ]));
    nameInput.readOnly = true;
  }

  async function previewCreate(btn, name) {
    busy(btn, true, t('creating'));
    try {
      const pv = await p360(ctx, 'previewIdentity', { data: {
        kind: 'person', idempotencyKey: uuid(), displayName: name,
      } });
      busy(btn, false, t('btn_create'));
      sheet.swap(h('div', {}, [
        previewBlock([
          kvRow(t('new_person_name'), name),
          h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('new_person_preview_note')),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doCreate(e.currentTarget, pv) }, t('btn_confirm')),
        ]),
      ]));
    } catch (err) { busy(btn, false, t('btn_create')); sheet.showErr(err.message); }
  }

  async function doCreate(btn, pv) {
    busy(btn, true, t('creating'));
    try {
      const created = await p360(ctx, 'executeIdentity', { data: { previewId: pv.previewId } });
      if (!created || !created.personId) throw new Error(t('create_failed'));
      sheet.overlay.remove();
      ctx.toast(`${t('person_created')} #${created.personId} · ${t('new_person_profile_note')}`, 'ok');
      if (onDone) onDone(created.personId);
    } catch (err) { busy(btn, false, t('btn_confirm')); sheet.showErr(err.message); }
  }
}

// Person → role conversion is a reviewed server command: preview first, then explicit human confirmation.
async function restorePreviousRoleIfPresent(ctx, { person, kind, sheet, onDone, restoredState, nextStep = 0 }) {
  const restored = restoredState || new Set();
  const roleLabel = kind === 'customer' ? t('customer') : t('recruit');
  const itemCounts = row => Object.entries(row.counts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => `${t(({ followups: 'trash_count_followups', gifts: 'trash_count_gifts', photos: 'trash_count_photos',
      policy_review_reports: 'trash_count_reports', ocr_records: 'trash_count_ocr', products: 'trash_count_products',
      recruit_candidates: 'trash_count_recruits', recruit_followups: 'l07_recruit_followups' })[name] || name)} ${count}`)
    .join(' · ');
  const recoveryRoot = state => {
    if (kind === 'customer' && state.customer?.deleted) {
      return { kind: 'customer', id: Number(state.customer.id), name: state.displayName, parent: false };
    }
    if (kind === 'recruit' && state.recruit?.deleted) {
      if (state.parentCustomer?.deleted) {
        return { kind: 'customer', id: Number(state.parentCustomer.id), name: state.displayName, parent: true };
      }
      return { kind: state.recruit.personOnly ? 'person_recruit' : 'recruit',
        id: Number(state.recruit.id), name: state.displayName, parent: false };
    }
    return null;
  };

  for (let step = nextStep; step < 3; step += 1) {
    const state = await data.personRoleRecovery(ctx, person.id, kind);
    if (!state || state.error) throw new Error(state?.message || state?.error || t('write_failed'));
    const root = recoveryRoot(state);
    if (!root) {
      if (!restored.size) return false;
      sheet.overlay.remove();
      const message = restored.has('recruit')
        ? (restored.has('customer') ? t('role_recovery_done_both') : t('role_recovery_done_recruit'))
        : t('role_recovery_done_customer');
      ctx.toast(message.replace('{role}', roleLabel), 'ok');
      onDone?.();
      return true;
    }
    if (!Number.isSafeInteger(root.id) || root.id < 1) throw new Error(t('trash_invalid_result'));

    const preview = await data.previewRecycleBatch(ctx, {
      requestKey: uuid(), items: [{ kind: root.kind, id: root.id }],
    });
    if (!preview || !preview.previewId || !Array.isArray(preview.items) || preview.items.length !== 1) {
      throw new Error(t('trash_invalid_result'));
    }
    const row = preview.items[0];
    if (row.id !== root.id || row.kind !== root.kind) throw new Error(t('trash_invalid_result'));
    const canRestore = row.code === 'READY';
    const noteKey = root.parent ? 'role_recovery_parent_customer_note'
      : root.kind === 'customer' ? 'role_recovery_customer_note' : 'role_recovery_recruit_note';
    const actions = h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: !canRestore },
        canRestore ? t('role_recovery_confirm') : t(`l07_code_${row.code}`)),
    ]);
    const confirm = actions.querySelector('.btn-primary');
    sheet.swap(h('div', {}, [
      h('p', { class: 'sheet-note' }, t(noteKey).replace('{role}', roleLabel)),
      h('div', { class: 'card card-body' }, [
        h('b', {}, `${root.name || person.display_name} #${root.id}`),
        h('div', {}, t(`l07_code_${row.code}`)),
        row.batchId ? h('small', { class: 'foot-note' }, `${t('l07_batch')} ${row.batchId}${itemCounts(row) ? ` · ${itemCounts(row)}` : ''}`) : null,
      ]),
      h('p', { class: 'foot-note' }, `${t('l07_expires')} ${new Date(preview.expiresAt).toLocaleString()}`),
      actions,
    ]));
    confirm.onclick = async () => {
      if (!canRestore || confirm.disabled) return;
      confirm.disabled = true;
      let result;
      try {
        result = await data.executeRecycleBatch(ctx, preview.previewId);
      } catch (executeError) {
        try { result = await data.getRecycleBatch(ctx, preview.previewId); }
        catch { sheet.showErr(t('role_recovery_uncertain')); confirm.disabled = false; return; }
        if (result?.status !== 'executed') {
          sheet.showErr(t('role_recovery_uncertain'));
          confirm.disabled = false;
          return;
        }
      }
      const restoredRow = result?.results?.[0];
      if (result?.status !== 'executed' || !restoredRow || !['RESTORED', 'ALREADY_RESTORED'].includes(restoredRow.code)) {
        sheet.showErr(restoredRow?.code ? t(`l07_code_${restoredRow.code}`) : t('trash_invalid_result'));
        confirm.disabled = false;
        return;
      }
      restored.add(root.kind === 'customer' ? 'customer' : 'recruit');
      if (kind === 'recruit' && root.kind === 'customer' && Number(restoredRow.counts?.recruit_candidates) > 0) {
        restored.add('recruit');
      }
      // A deleted linked candidate can outlive the customer's deletion batch. Re-read
      // and restore that candidate separately after its parent has become active.
      await restorePreviousRoleIfPresent(ctx, { person, kind, sheet, onDone, restoredState: restored, nextStep: step + 1 });
    };
    return true;
  }
  if (restored.size) {
    sheet.overlay.remove();
    ctx.toast(restored.has('recruit') && restored.has('customer')
      ? t('role_recovery_done_both') : restored.has('recruit')
        ? t('role_recovery_done_recruit') : t('role_recovery_done_customer'), 'ok');
    onDone?.();
    return true;
  }
  return false;
}

export function openPersonRoleConversion(ctx, { person, kind, onDone } = {}) {
  if (!person?.id || !['customer', 'recruit'].includes(kind)) return;
  const label = kind === 'customer' ? t('customer') : t('recruit');
  const sheet = openSheet({
    title: t('role_conversion_title').replace('{role}', label),
    sub: person.display_name || `#${person.id}`,
    body: h('div', { class: 'muted' }, t('edit_loading')),
  });
  document.body.appendChild(sheet.overlay);
  (async () => {
    try {
      if (await restorePreviousRoleIfPresent(ctx, { person, kind, sheet, onDone })) return;
      const pv = await p360(ctx, 'previewIdentity', { data: {
        kind, personId: String(person.id), displayName: person.display_name,
        idempotencyKey: uuid(),
      } });
      if (!pv || pv.error || !pv.previewId) throw new Error(pv?.message || pv?.error || t('role_conversion_preview_failed'));
      const preview = pv.preview || {};
      const previewRows = [
        kvRow(t('field_name'), preview.displayName || person.display_name),
        kvRow(t('role_conversion_target'), label),
      ];
      if (preview.customerId) previewRows.push(kvRow(t('role_conversion_existing_customer'), `#${preview.customerId}`));
      if (preview.recruitId) previewRows.push(kvRow(t('role_conversion_existing_recruit'), `#${preview.recruitId}`));
      sheet.swap(h('div', {}, [
        h('p', { class: 'sheet-note' }, t('role_conversion_preview')),
        previewBlock(previewRows),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => execute(e.currentTarget, pv) }, t('btn_confirm')),
        ]),
      ]));
    } catch (err) { sheet.showErr(err.message); }
  })();

  async function execute(btn, pv) {
    busy(btn, true, t('creating'));
    try {
      const result = await p360(ctx, 'executeIdentity', { data: { previewId: pv.previewId } });
      if (!result || result.error || result.ok === false) throw new Error(result?.message || result?.error || t('create_failed'));
      sheet.overlay.remove();
      ctx.toast(t('role_conversion_done').replace('{role}', label), 'ok');
      onDone?.();
    } catch (err) { busy(btn, false, t('btn_confirm')); sheet.showErr(err.message); }
  }
}

export function openPersonCustomerRemove(ctx, { customerId, onDone } = {}) {
  const id = Number(customerId);
  if (!Number.isSafeInteger(id) || id < 1) return;
  const sheet = openSheet({
    title: t('customer_role_remove_title'),
    sub: t('customer_role_remove_note'),
    body: h('div', {}, [
      h('p', { class: 'sheet-note' }, t('customer_role_remove_cascade')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
          const button = event.currentTarget;
          busy(button, true, t('writing'));
          try {
            const result = await data.removeCustomerRole(ctx, id);
            if (!result || result.ok === false || result.error) throw new Error(result?.error || t('write_failed'));
            sheet.overlay.remove();
            ctx.toast(t('customer_role_remove_done'), 'ok');
            onDone?.();
          } catch (error) { busy(button, false, t('customer_role_remove')); sheet.showErr(error.message || t('write_failed')); }
        } }, t('customer_role_remove')),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
}

export function openRecruitCandidateRemove(ctx, { candidate, onDone } = {}) {
  const id = Number(candidate?.id);
  if (!Number.isSafeInteger(id) || id < 1) return;
  const sheet = openSheet({
    title: t('recruit_role_remove_title'),
    sub: `${candidate.name || candidate.display_name || ''} #${id}`,
    body: h('div', {}, [
      h('p', { class: 'sheet-note' }, t('recruit_role_remove_note')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
          const button = event.currentTarget;
          busy(button, true, t('writing'));
          try {
            const result = await data.removeRecruitRole(ctx, id);
            if (!result || result.ok === false || result.error) throw new Error(result?.error || t('write_failed'));
            sheet.overlay.remove();
            ctx.toast(t('recruit_role_remove_done'), 'ok');
            onDone?.();
          } catch (error) { busy(button, false, t('recruit_role_remove')); sheet.showErr(error.message || t('write_failed')); }
        } }, t('recruit_role_remove')),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
}

// ---------- 人物：编辑基础资料（updatePerson，乐观锁；客户档案字段不在本表单范围） ----------
export function openPersonEdit(ctx, { personId, onDone } = {}) {
  const sheet = openSheet({
    title: t('edit_person_title'), sub: t('edit_scope_note'),
    body: h('div', { class: 'muted' }, t('edit_loading')),
  });
  document.body.appendChild(sheet.overlay);
  (async () => {
    let profile;
    try { profile = await p360(ctx, 'getCustomerProfile', { personId: String(personId) }); }
    catch (err) { sheet.showErr(err.message); return; }
    if (profile && profile.error) { sheet.showErr(String(profile.error)); return; }
    const f = profile.fields || {};
    const nameInput = h('input', { class: 'sheet-input', maxlength: '120', value: f.customer_name || '' });
    const phoneInput = h('input', { class: 'sheet-input', maxlength: '40', value: f.phone || '' });
    const birthdayInput = h('input', { class: 'sheet-input', type: 'date', value: String(f.birthday || '').slice(0, 10) });
    const genderSel = sel([['', '—'], ['男', t('gender_male')], ['女', t('gender_female')], ['未知', t('gender_unknown')]], f.gender || '');
    const occupationInput = h('input', { class: 'sheet-input', maxlength: '120', value: f.occupation || '' });
    const organizationInput = h('input', { class: 'sheet-input', maxlength: '120', value: f.organization || '' });
    const educationInput = h('input', { class: 'sheet-input', maxlength: '120', value: f.education || '' });
    const wechatInput = h('input', { class: 'sheet-input', maxlength: '80', value: f.wx_account || '' });
    const sourceInput = h('input', { class: 'sheet-input', maxlength: '120', value: f.source || '' });
    const hobbiesTa = h('textarea', { class: 'sheet-textarea', style: 'min-height:56px', maxlength: '1000' }, f.hobbies || '');
    const stageSel = sel([
      ['', '—'], ['新认识', t('customer_stage_new')], ['关系维护', t('customer_stage_maintenance')],
      ['需求挖掘', t('customer_stage_discovery')], ['方案沟通', t('customer_stage_proposal')],
      ['成交推进', t('customer_stage_closing')], ['转介绍经营', t('customer_stage_referral')],
    ], f.customer_stage || '');
    const priorityOptions = [['', '—'], ...['A', 'B', 'C', 'D', 'E'].map(v => [v, t(`priority_${v.toLowerCase()}`)])];
    const salesPrioritySel = sel(priorityOptions, f.sales_priority || '');
    const referralPrioritySel = sel(priorityOptions, f.referral_priority || '');
    const maritalSel = sel([
      ['', '—'], ['未婚', t('marital_single')], ['已婚', t('marital_married')], ['未知', t('marital_unknown')],
    ], f.marital_status || '');
    const firstContactInput = h('input', { class: 'sheet-input', type: 'date', value: String(f.first_contact_date || '').slice(0, 10) });
    const notesTa = h('textarea', { class: 'sheet-textarea', style: 'min-height:64px', maxlength: '2000' }, f.person_notes || '');
    const hasCustomer = profile.status === 'linked' && !!profile.customerId;
    const customerProfile = f.profile && typeof f.profile === 'object' && !Array.isArray(f.profile) ? f.profile : {};
    const customerTags = h('textarea', { class: 'sheet-textarea', maxlength: '2000' }, f.tags || '');
    const customerNotes = h('textarea', { class: 'sheet-textarea', maxlength: '4000' }, f.additional_info || '');
    const incomeInput = h('input', { class: 'sheet-input', type: 'number', min: '0', step: '1', value: f.annual_income ?? '' });
    const householdIncome = h('input', { class: 'sheet-input', maxlength: '120', value: f.household_income || '' });
    const propertiesInfo = h('textarea', { class: 'sheet-textarea', maxlength: '2000' }, f.properties_info || '');
    const mbtiInput = h('input', { class: 'sheet-input', maxlength: '20', value: f.mbti || '' });
    const profileInputs = Object.fromEntries(['family', 'children', 'parents', 'career', 'needs', 'relationship'].map(key => [
      key, h('textarea', { class: 'sheet-textarea', maxlength: '2000' }, customerProfile[key] || ''),
    ]));
    const profileEvents = h('textarea', { class: 'sheet-textarea', style: 'min-height:76px', maxlength: '4000' },
      JSON.stringify(Array.isArray(customerProfile.events) ? customerProfile.events : [], null, 2));
    const customerPriorityOptions = [['', '—'], ...['A', 'B', 'C', 'D', 'E'].map(v => [v, t(`priority_${v.toLowerCase()}`)])];
    const recruitPrioritySel = sel(customerPriorityOptions, f.recruitment_priority || '');
    const nodes = [
      fieldRow(t('field_name'), nameInput),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_phone')), phoneInput]),
        h('div', { class: 'sheet-field', style: 'width:170px' }, [h('label', {}, t('field_birthday')), birthdayInput]),
      ]),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_gender')), genderSel]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_wechat')), wechatInput]),
      ]),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_occupation')), occupationInput]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_organization')), organizationInput]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_education')), educationInput]),
      ]),
      fieldRow(t('field_source'), sourceInput),
      fieldRow(t('field_hobbies'), hobbiesTa),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_customer_stage')), stageSel]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_sales_priority')), salesPrioritySel]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_referral_priority')), referralPrioritySel]),
      ]),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_marital')), maritalSel]),
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('field_first_contact_date')), firstContactInput]),
      ]),
      fieldRow(t('field_notes'), notesTa),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doSave(e.currentTarget) }, t('btn_save')),
      ]),
    ];
    nodes.push(h('hr', { class: 'sheet-divider' }));
    nodes.push(h('h3', { class: 'sheet-section-title' }, t('sec_customer_business')));
    if (hasCustomer) {
      nodes.push(
        fieldRow(t('field_customer_tags'), customerTags),
        fieldRow(t('field_customer_notes'), customerNotes),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
          h('div', { class: 'sheet-field', style: 'flex:1;min-width:220px' }, [h('label', {}, t('field_income')), incomeInput]),
          h('div', { class: 'sheet-field', style: 'flex:1;min-width:220px' }, [h('label', {}, t('field_household_income')), householdIncome]),
        ]),
        fieldRow(t('field_properties'), propertiesInfo),
        fieldRow(t('field_mbti'), mbtiInput),
        ...Object.entries(profileInputs).map(([key, input]) => fieldRow(t(`profile_${key}`), input)),
        fieldRow(t('field_customer_profile_json'), profileEvents, t('customer_profile_json_hint')),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-soft', type: 'button', onclick: (e) => saveCustomer(e.currentTarget) }, t('btn_save_customer_profile')),
        ]),
      );
    } else {
      nodes.push(h('p', { class: 'sheet-note' }, t('customer_profile_unavailable_note')));
    }
    if (f.recruit_id) {
      nodes.push(
        h('h3', { class: 'sheet-section-title' }, t('col_recruit_priority')),
        fieldRow(t('col_recruit_priority'), recruitPrioritySel),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-soft', type: 'button', onclick: (e) => saveRecruitPriority(e.currentTarget) }, t('btn_save_recruit_priority')),
        ]),
      );
    }
    sheet.swap(h('div', {}, nodes));

    async function doSave(btn) {
      // linked 人物的 f.updated_at 属于 customers 行；乐观锁必须使用 persons 版本号 person_updated_at
      const data = { personId: String(personId), expectedUpdatedAt: f.person_updated_at || f.updated_at };
      const changed = {};
      const put = (key, val, orig) => { if (String(val ?? '') !== String(orig ?? '')) changed[key] = val; };
      put('displayName', nameInput.value.trim(), f.customer_name);
      put('phone', phoneInput.value.trim(), f.phone);
      put('birthday', birthdayInput.value, String(f.birthday || '').slice(0, 10));
      put('gender', genderSel.value, f.gender || '');
      put('occupation', occupationInput.value.trim(), f.occupation);
      put('organization', organizationInput.value.trim(), f.organization);
      put('education', educationInput.value.trim(), f.education);
      put('wechat', wechatInput.value.trim(), f.wx_account);
      put('source', sourceInput.value.trim(), f.source);
      put('hobbies', hobbiesTa.value.trim(), f.hobbies);
      put('customerStage', stageSel.value, f.customer_stage || '');
      put('salesPriority', salesPrioritySel.value, f.sales_priority || '');
      put('referralPriority', referralPrioritySel.value, f.referral_priority || '');
      put('maritalStatus', maritalSel.value, f.marital_status || '');
      put('firstContactDate', firstContactInput.value, String(f.first_contact_date || '').slice(0, 10));
      put('notes', notesTa.value.trim(), f.person_notes);
      if (!Object.keys(changed).length) { sheet.showErr(t('edit_no_changes')); return; }
      Object.assign(data, changed);
      if (changed.displayName === '') { sheet.showErr(t('new_person_name')); return; }
      busy(btn, true, t('saving'));
      try {
        const res = await p360(ctx, 'updatePerson', { data });
        if (res && res.conflict) { busy(btn, false, t('btn_save')); sheet.showErr(t('edit_conflict')); return; }
        if (!res || res.ok === false) throw new Error((res && res.message) || t('save_failed'));
        sheet.overlay.remove();
        ctx.toast(t('person_saved'), 'ok');
        if (onDone) onDone();
      } catch (err) { busy(btn, false, t('btn_save')); sheet.showErr(err.message); }
    }

    async function saveCustomer(btn) {
      if (!hasCustomer || !profile.customerId) { sheet.showErr(t('customer_profile_unavailable_note')); return; }
      const changed = {};
      const put = (key, val, orig) => { if (String(val ?? '') !== String(orig ?? '')) changed[key] = val; };
      put('tags', customerTags.value.trim() || null, f.tags);
      put('additional_info', customerNotes.value.trim() || null, f.additional_info);
      put('household_income', householdIncome.value.trim() || null, f.household_income);
      put('properties_info', propertiesInfo.value.trim() || null, f.properties_info);
      put('mbti', mbtiInput.value.trim() || null, f.mbti);
      if (incomeInput.value.trim() === '') {
        put('annual_income', null, f.annual_income);
      } else {
        const income = Number(incomeInput.value);
        if (!Number.isSafeInteger(income) || income < 0) { sheet.showErr(t('customer_income_invalid')); return; }
        put('annual_income', income, f.annual_income);
      }
      const nextProfile = { ...customerProfile };
      let profileChanged = false;
      for (const [key, input] of Object.entries(profileInputs)) {
        const value = input.value.trim() || null;
        if (String(value ?? '') !== String(customerProfile[key] ?? '')) {
          nextProfile[key] = value;
          profileChanged = true;
        }
      }
      let events;
      try {
        events = JSON.parse(profileEvents.value || '[]');
        if (!Array.isArray(events)) throw new Error('events must be an array');
      } catch (_) { sheet.showErr(t('customer_profile_json_invalid')); return; }
      if (JSON.stringify(events) !== JSON.stringify(Array.isArray(customerProfile.events) ? customerProfile.events : [])) {
        nextProfile.events = events;
        profileChanged = true;
      }
      if (profileChanged) changed.profile = nextProfile;
      if (!Object.keys(changed).length) { sheet.showErr(t('edit_no_changes')); return; }
      busy(btn, true, t('saving'));
      try {
        const res = await ctx.api.call('customers', {
          action: 'update', id: String(profile.customerId), data: changed,
          expectedUpdatedAt: f.updated_at, editSource: 'form',
        });
        if (res?.conflict || res?.code === 'CUSTOMER_CONFLICT') {
          busy(btn, false, t('btn_save_customer_profile')); sheet.showErr(t('customer_profile_conflict')); return;
        }
        if (res?.error || !res || res.ok === false) throw new Error(res?.error || t('customer_profile_save_failed'));
        sheet.overlay.remove();
        ctx.toast(t('customer_profile_saved'), 'ok');
        if (onDone) onDone();
      } catch (err) {
        busy(btn, false, t('btn_save_customer_profile'));
        sheet.showErr(`${t('customer_profile_save_failed')}: ${err.message || ''}`);
      }
    }

    async function saveRecruitPriority(btn) {
      if (!f.recruit_id) { sheet.showErr(t('recruit_priority_unavailable')); return; }
      if (String(recruitPrioritySel.value || '') === String(f.recruitment_priority || '')) {
        sheet.showErr(t('edit_no_changes')); return;
      }
      busy(btn, true, t('saving'));
      try {
        const res = await ctx.api.call('recruit_candidates', {
          action: 'update', id: String(f.recruit_id), data: { recruitment_priority: recruitPrioritySel.value || null },
          expectedUpdatedAt: f.recruit_updated_at,
        });
        if (res?.conflict || res?.code === 'RECRUIT_CONFLICT') {
          busy(btn, false, t('btn_save_recruit_priority')); sheet.showErr(t('recruit_priority_conflict')); return;
        }
        if (res?.error || !res || res.ok === false) throw new Error(res?.error || t('customer_profile_save_failed'));
        sheet.overlay.remove();
        ctx.toast(t('recruit_priority_saved'), 'ok');
        if (onDone) onDone();
      } catch (err) {
        busy(btn, false, t('btn_save_recruit_priority'));
        sheet.showErr(`${t('customer_profile_save_failed')}: ${err.message || ''}`);
      }
    }
  })();
}

// ---------- 人物：删除（服务端预览 → 人工确认 → 执行；级联软删除，回收站可恢复） ----------
export function openPersonDelete(ctx, { personId, displayName, onDone } = {}) {
  const sheet = openSheet({
    title: t('del_person_title'), sub: displayName || `#${personId}`,
    body: h('div', { class: 'muted' }, t('edit_loading')),
  });
  document.body.appendChild(sheet.overlay);
  (async () => {
    let pv;
    try {
      pv = await p360(ctx, 'previewPersonDelete', { data: { idempotencyKey: uuid(), personId: String(personId) } });
    } catch (err) { sheet.showErr(err.message); return; }
    const p = (pv && pv.preview) || {};
    const cascade = [];
    if (p.customerId) cascade.push(kvRow(t('del_cascade_customer'), `#${p.customerId}`));
    if (p.recruitCount) cascade.push(kvRow(t('del_cascade_recruit'), `×${p.recruitCount}`));
    if (p.opportunityCount) cascade.push(kvRow(t('del_cascade_opportunity'), `×${p.opportunityCount}`));
    if (p.relationshipCount) cascade.push(kvRow(t('del_cascade_relationship'), `×${p.relationshipCount}`));
    if (p.householdCount) cascade.push(kvRow(t('del_cascade_household'), `×${p.householdCount}`));
    if (p.householdMembershipCount) cascade.push(kvRow(t('del_cascade_membership'), `×${p.householdMembershipCount}`));
    if (p.participantCount) cascade.push(kvRow(t('del_cascade_participant'), `×${p.participantCount}`));
    if (p.speakerCount) cascade.push(kvRow(t('del_cascade_speaker'), `×${p.speakerCount}`));
    const ledger = t('del_ledger_note')
      .replace('{interactions}', p.interactionCount || 0)
      .replace('{actions}', p.openActionCount || 0)
      .replace('{commitments}', p.openCommitmentCount || 0)
      .replace('{contexts}', p.contextItemCount || 0);
    const notes = [h('div', { class: 'sheet-note', style: 'margin-top:8px' }, ledger)];
    if (p.customerAlreadyDeleted) {
      notes.push(h('div', { class: 'sheet-note', style: 'margin-top:4px' }, t('del_customer_skip_note')));
    }
    if (!cascade.length) {
      notes.push(h('div', { class: 'sheet-note', style: 'margin-top:4px' }, t('del_none_note')));
    }
    sheet.swap(h('div', {}, [
      h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('del_person_preview_note')),
      previewBlock([
        kvRow(t('new_person_name'), p.displayName || displayName || `#${personId}`),
        ...cascade,
        ...notes,
      ]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doDelete(e.currentTarget, pv) }, t('btn_confirm_delete')),
      ]),
    ]));
  })();

  async function doDelete(btn, pv) {
    busy(btn, true, t('deleting'));
    try {
      const res = await p360(ctx, 'executePersonDelete', { data: { previewId: pv.previewId } });
      if (!res || res.ok === false) throw new Error(t('delete_failed'));
      sheet.overlay.remove();
      ctx.toast(t('person_deleted'), 'ok');
      if (onDone) onDone();
    } catch (err) { busy(btn, false, t('btn_confirm_delete')); sheet.showErr(err.message); }
  }
}

// Person 360 timeline writes. Legacy follow-ups remain in followups; manual events use
// the existing person_360.createInteraction action and are never mirrored to followups.
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localDateTime = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
export function openPersonInteraction(ctx, { personId, onDone } = {}) {
  if (!/^[1-9]\d*$/.test(String(personId || ''))) return;
  const type = sel([
    ['meeting', t('interaction_type_meet')], ['call', t('interaction_type_call')],
    ['message', t('interaction_type_wechat')], ['note', t('interaction_type_other')],
  ], 'meeting');
  const at = h('input', { class: 'sheet-input', type: 'datetime-local', value: localDateTime(), required: true });
  const channel = sel([
    ['', t('channel_none')], ['in_person', t('interaction_type_meet')],
    ['phone', t('interaction_type_call')], ['wechat', t('interaction_type_wechat')],
    ['email', t('channel_email')], ['other', t('interaction_type_other')],
  ], '');
  const summary = h('textarea', { class: 'sheet-textarea', maxlength: '2000', required: true });
  const rawNote = h('textarea', { class: 'sheet-textarea', maxlength: '10000' });
  const submit = h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, t('btn_save'));
  const sheet = openSheet({ title: t('interaction_create_title'), sub: `Person #${personId}`, body: h('div', {}, [
    fieldRow(t('interaction_type_label'), type), fieldRow(t('interaction_at_label'), at),
    fieldRow(t('interaction_channel_label'), channel), fieldRow(t('followup_summary_label'), summary),
    fieldRow(t('interaction_raw_note_label'), rawNote),
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      submit,
    ]),
  ]) });
  document.body.appendChild(sheet.overlay);

  async function save() {
    if (submit.disabled) return;
    if (!at.value || !Number.isFinite(new Date(at.value).getTime()) || !summary.value.trim()) {
      sheet.showErr(t('save_failed')); return;
    }
    busy(submit, true, t('saving'));
    try {
      const result = await data.createInteraction(ctx, String(personId), {
        interaction_type: type.value, interaction_at: new Date(at.value).toISOString(),
        channel: channel.value || null, summary: summary.value.trim(), raw_note: rawNote.value.trim() || null,
      });
      if (!result.interaction?.id) throw new Error(t('save_failed'));
      sheet.overlay.remove();
      ctx.toast(t('interaction_recorded'), 'ok');
      onDone?.();
    } catch (err) { busy(submit, false, t('btn_save')); sheet.showErr(err.message || t('save_failed')); }
  }
}

export function openPersonFollowup(ctx, { personId, customerId, followupId = null, onDone } = {}) {
  if (!/^[1-9]\d*$/.test(String(personId || '')) || !/^[1-9]\d*$/.test(String(customerId || ''))) return;
  const editing = followupId != null;
  const title = editing ? t('followup_edit_title') : t('followup_create_title');
  const sheet = openSheet({ title, sub: `Person #${personId} · Customer #${customerId}`,
    body: h('div', { class: 'muted' }, t('edit_loading')) });
  document.body.appendChild(sheet.overlay);
  (async () => {
    try {
      const [followupResult, recommendationResult] = await Promise.all([
        editing ? data.customerFollowups(ctx, customerId) : Promise.resolve({ rows: [] }),
        data.customerRecommendations(ctx, customerId).catch(() => ({ rows: [] })),
      ]);
      const rows = Array.isArray(followupResult.rows) ? followupResult.rows : [];
      const source = editing ? rows.find(row => String(row.Id) === String(followupId) &&
        String(row.customer_id) === String(customerId) && row.deleted_at == null) : null;
      if (editing && !source) throw new Error(t('followup_source_unavailable'));
      const recommendations = Array.isArray(recommendationResult.rows) ? recommendationResult.rows : [];
      const recOptions = [['', t('recommendation_none')], ...recommendations.map(row => {
        const label = [row.recommendation_date, row.suggested_followup_goal,
          row.suggested_message].filter(Boolean).join(' · ').slice(0, 100);
        return [String(row.id), `#${row.id}${label ? ` · ${label}` : ''}`];
      })];
      const currentRec = source?.recommendation_id == null ? '' : String(source.recommendation_id);
      if (currentRec && !recOptions.some(([id]) => id === currentRec)) recOptions.push([currentRec, `#${currentRec}`]);
      const followupDate = h('input', { class: 'sheet-input', type: 'date', required: true,
        value: String(source?.followup_date || localDate()).slice(0, 10) });
      const followupNotes = h('textarea', { class: 'sheet-textarea', maxlength: '10000' }, source?.followup_notes || '');
      const interactionSummary = h('textarea', { class: 'sheet-textarea', maxlength: '2000' }, source?.interaction_summary || '');
      const nextDate = h('input', { class: 'sheet-input', type: 'date', value: String(source?.next_followup_date || '').slice(0, 10) });
      const nextGoal = h('input', { class: 'sheet-input', maxlength: '1000', value: source?.next_followup_goal || '' });
      const recommendation = sel(recOptions, currentRec);
      const activityId = h('input', { class: 'sheet-input', type: 'number', min: '1', step: '1', value: source?.activity_id ?? '' });
      const nextAction = h('input', { class: 'sheet-input', maxlength: '1000', value: source?.next_action || '' });
      const nextActionDate = h('input', { class: 'sheet-input', type: 'date', value: String(source?.next_action_date || '').slice(0, 10) });
      const saveButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, t('btn_save'));
      const form = h('div', {}, [
        fieldRow(t('followup_date_label'), followupDate),
        fieldRow(t('followup_summary_label'), interactionSummary),
        fieldRow(t('followup_notes_label'), followupNotes),
        h('div', { class: 'sheet-note' }, t('recommendation_link_preserved')),
        fieldRow(t('followup_recommendation_label'), recommendation),
        fieldRow(t('followup_activity_label'), activityId),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
          h('div', { class: 'sheet-field', style: 'flex:1;min-width:220px' }, [h('label', {}, t('followup_next_date_label')), nextDate]),
          h('div', { class: 'sheet-field', style: 'flex:1;min-width:220px' }, [h('label', {}, t('followup_next_goal_label')), nextGoal]),
        ]),
        fieldRow(t('followup_next_action_label'), nextAction),
        fieldRow(t('followup_next_action_date_label'), nextActionDate),
        h('div', { class: 'sheet-actions' }, [
          editing ? h('button', { class: 'btn btn-ghost', type: 'button', style: 'color:var(--red)',
            onclick: confirmDelete }, t('delete_followup')) : null,
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          saveButton,
        ]),
      ]);
      sheet.swap(form);

      async function save() {
        if (saveButton.disabled) return;
        if (!followupDate.value || (!followupNotes.value.trim() && !interactionSummary.value.trim())) {
          sheet.showErr(t('followup_content_required')); return;
        }
        const numericActivity = activityId.value.trim();
        if (numericActivity && !/^[1-9]\d*$/.test(numericActivity)) {
          sheet.showErr(t('followup_invalid_activity')); return;
        }
        const payload = {
          followup_date: followupDate.value,
          interaction_summary: interactionSummary.value.trim() || null,
          followup_notes: followupNotes.value.trim() || null,
          next_followup_date: nextDate.value || null,
          next_followup_goal: nextGoal.value.trim() || null,
          recommendation_id: recommendation.value ? Number(recommendation.value) : null,
          activity_id: numericActivity ? Number(numericActivity) : null,
          next_action: nextAction.value.trim() || null,
          next_action_date: nextActionDate.value || null,
        };
        busy(saveButton, true, t('saving'));
        try {
          const result = editing
            ? await data.updateCustomerFollowup(ctx, source.Id, payload)
            : await data.createCustomerFollowup(ctx, { ...payload, customer_id: Number(customerId) });
          if (editing ? result.ok !== true : !result.id) throw new Error(t('save_failed'));
          sheet.overlay.remove();
          ctx.toast(editing ? t('followup_updated') : t('followup_saved'), 'ok');
          onDone?.();
        } catch (err) { busy(saveButton, false, t('btn_save')); sheet.showErr(err.message || t('save_failed')); }
      }

      function confirmDelete() {
        const confirmButton = h('button', { class: 'btn btn-primary', type: 'button', style: 'background:var(--red)',
          onclick: remove }, t('delete_followup'));
        sheet.swap(h('div', {}, [
          h('p', { class: 'sheet-note' }, t('followup_delete_confirm')),
          h('div', { class: 'sheet-actions' }, [
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.swap(form) }, t('cancel')),
            confirmButton,
          ]),
        ]));
        async function remove() {
          if (confirmButton.disabled) return;
          busy(confirmButton, true, t('deleting'));
          try {
            const result = await data.removeCustomerFollowup(ctx, source.Id);
            if (result.ok !== true) throw new Error(t('followup_source_unavailable'));
            sheet.overlay.remove();
            ctx.toast(t('followup_deleted'), 'ok');
            onDone?.();
          } catch (err) { busy(confirmButton, false, t('delete_followup')); sheet.showErr(err.message || t('delete_failed')); }
        }
      }
    } catch (err) { sheet.showErr(err.message || t('save_failed')); }
  })();
}
