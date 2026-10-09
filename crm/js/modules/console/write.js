// Console 写入闭环（WP2）：全部写操作走「服务端预览 → 人工确认 → 执行」三段式。
// 服务端均为既有实现，本模块零云函数/数据库变更，不直连数据库：
// - 行动/承诺完成: person_360 previewWorkItem{data:{idempotencyKey,kind,operation,personId,itemId,draft}}
//     → {previewId,preview:{before,after}} → executeWorkItem{previewId}
// - 机会推进/关闭/新建: person_360 previewOpportunity/executeOpportunity（stage/close/create）
// - 机会候选三键: assistant opportunityCandidate edit/reject/preview→confirm(previewHash)→execute
// - 快速记录: ai_parse quick_capture（只读解析）→ person_360 resolveQuickCaptureName（服务端身份解析）
//     → 人工点选候选 → commitQuickCaptureV2{confirmed:true}（服务端再次校验所选候选未变）
import { h } from './dom.js';
import { ic } from './icons.js';
import { bdg, fmtDate, dueLabel, textOf } from './ui.js';
import { t, translateEnum } from './i18n.js';

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
const STAGE_OPTIONS = ['发现', '沟通', '方案', '潜在线索', '已介绍', '已联系', '已建立关系'];
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
  const overlay = h('div', { class: 'sheet-overlay' }, [
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, [
      h('div', { class: 'sheet-head' }, [
        h('b', { class: 'sheet-title' }, title),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': t('close_aria'),
          onclick: () => overlay.remove(),
        }, [ic('x')]),
      ]),
      sub ? h('p', { class: 'sheet-sub' }, sub) : null,
      bodyEl,
    ]),
  ]);
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
              ctx.toast(kind === 'action' ? t('action_completed') : t('commitment_fulfilled'), 'ok');
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

// ---------- 机会：推进 / 关闭 ----------
export function openOpportunityAdvance(ctx, { opportunity, personName, onDone }) {
  const status = opportunity.status || '发现';
  const modeSel = sel([['stage', t('advance_stage')], ['close', t('close_won')]], 'stage');
  const stageSel = sel(STAGE_OPTIONS.filter((s) => s !== status).map((s) => [s, stageLabel(s)]), '沟通');
  const closeSel = sel([['成交', t('won')], ['关闭', t('closed')]], '成交');
  const resultTa = h('textarea', { class: 'sheet-textarea', placeholder: t('outcome_required') });
  const form = h('div', {}, [
    fieldRow(t('operation'), modeSel),
    h('div', { id: 'opp-stage-wrap' }, [fieldRow(t('advance_to'), stageSel,
      `${t('current_stage')}${stageLabel(status)}；${t('no_auto_advance')}`)]),
    h('div', { id: 'opp-close-wrap', style: 'display:none' }, [
      fieldRow(t('result'), closeSel),
      fieldRow(t('result_note'), resultTa, t('close_check_note')),
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
  modeSel.onchange = () => {
    form.querySelector('#opp-stage-wrap').style.display = modeSel.value === 'stage' ? '' : 'none';
    form.querySelector('#opp-close-wrap').style.display = modeSel.value === 'close' ? '' : 'none';
  };
  async function doPreview(btn) {
    sheet.showErr('');
    busy(btn, true, t('previewing'));
    const draft = modeSel.value === 'stage' ? { status: stageSel.value }
      : { actionId: null, status: closeSel.value, result: resultTa.value.trim() };
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
  const ta = h('textarea', {
    class: 'sheet-textarea', style: 'min-height:96px',
    placeholder: t('quick_capture_placeholder'),
  });
  const parseBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doParse(e.currentTarget) }, t('ai_parse'));
  const sheet = openSheet({
    title: t('quick_record'),
    sub: t('ai_parse_note'),
    body: h('div', {}, [ta, h('div', { class: 'sheet-actions' }, [parseBtn])]),
  });
  document.body.appendChild(sheet.overlay);
  async function doParse(btn) {
    const text = ta.value.trim();
    if (!text) { sheet.showErr(t('enter_content')); return; }
    busy(btn, true, t('ai_parsing'));
    try {
      const r = await aiParse(ctx, { action: 'quick_capture', text });
      busy(btn, false, t('ai_parse'));
      await renderReview(r, text, btn);
    } catch (err) {
      busy(btn, false, t('ai_parse'));
      sheet.showErr(`${t('ai_parse_failed')}${err.message}`);
    }
  }
  async function renderReview(r, text, parseBtn) {
    const p = r.parsed || {};
    // 服务端解析 canonical Person 候选（规则 14）：锁人直接复用；否则按 AI 识别的姓名解析。
    let fixed = null;
    if (personId) {
      const home = await p360(ctx, 'get', { personId: String(personId) });
      const name = home && home.person && home.person.display_name;
      if (name) fixed = { id: String(personId), displayName: name };
    }
    const resolution = fixed ? null
      : (p.person_name ? await p360(ctx, 'resolveQuickCaptureName', { name: p.person_name }) : null);
    const candidates = fixed ? [fixed] : ((resolution && resolution.candidates) || []);
    // 服务端允许在无同名（available）或带限定无匹配（confirm_new_qualified）时人工确认新建 Person；
    // AI 未识别人名时也允许手动填写姓名，保存前先做同名解析。
    const canCreate = !fixed && (!resolution ||
      (!resolution.hasMore && ['available', 'confirm_new_qualified'].includes(resolution.status)));
    const hint = fixed ? t('person_locked')
      : !p.person_name ? t('ai_no_name')
      : canCreate ? t('no_same_name')
      : candidates.length ? t('select_confirmed') : t('many_names');
    const candBox = h('div', {});
    let picked = fixed || null;
    const markActive = (node) => {
      candBox.querySelectorAll('.cand').forEach((n) => n.classList.remove('active'));
      node.classList.add('active');
    };
    candidates.forEach((c) => {
      candBox.appendChild(h('div', {
        class: 'cand' + (picked && String(picked.id) === String(c.id) ? ' active' : ''),
        onclick: (e) => { picked = c; markActive(e.currentTarget); },
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
    const factsWrap = listEditor(factList, t('facts_label'), t('max_20_items'));
    const sigsWrap = listEditor(sigList, t('signals_label'), t('max_12_signals'));
    const summaryTa = h('textarea', { class: 'sheet-textarea' },
      (p.facts || []).join('；') || '');
    const sheetBody = h('div', {}, [
      fieldRow(t('link_person'), candBox, hint),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, t('method')), typeSel]),
        h('div', { class: 'sheet-field', style: 'width:170px' }, [h('label', {}, t('date')), dateInput]),
      ]),
      factsWrap,
      sigsWrap,
      fieldRow(t('interaction_summary'), summaryTa, t('summary_note')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            if (!picked) { sheet.showErr(t('select_person_first')); return; }
            const facts = factsWrap.readValues().filter((x) => x.trim()).slice(0, 20);
            const signals = sigsWrap.readValues().filter((x) => x.trim()).slice(0, 12);
            if (facts.some((x) => x.length > 500) || signals.some((x) => x.length > 500)) {
              sheet.showErr(t('max_500_chars')); return;
            }
            const summary = (summaryTa.value || facts.join('；') || text).slice(0, 2000);
            if (!summary.trim()) { sheet.showErr(t('fill_summary_or_fact')); return; }
            const commit = (personId, displayName) => p360(ctx, 'commitQuickCaptureV2', { data: {
              confirmed: true,
              personId: String(personId),
              selectedDisplayName: displayName,
              interaction: {
                type: typeSel.value, at: dateToIso(dateInput.value || todayStr()), channel: '',
                summary, rawNote: text,
              },
              facts, signals,
            } });
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
                  if (res.hasMore || !['available', 'confirm_new_qualified'].includes(res.status)) {
                    busy(b, false, t('confirm_save'));
                    sheet.showErr(t('same_name_exists')); return;
                  }
                }
                const pv = await p360(ctx, 'previewIdentity', { data: {
                  kind: 'person', idempotencyKey: uuid(),
                  displayName: res.displayName, nameKey: res.nameKey,
                } });
                busy(b, false, t('confirm_save'));
                sheet.swap(h('div', {}, [
                  previewBlock([
                    kvRow(t('step1_new_person'), res.displayName),
                    kvRow(t('step2_interaction'), `${t('interaction_type_' + (typeSel.value === '见面' ? 'meet' : typeSel.value === '吃饭' ? 'meal' : typeSel.value === '电话' ? 'call' : typeSel.value === '微信' ? 'wechat' : typeSel.value === '活动' ? 'activity' : 'other'))} · ${dateInput.value || todayStr()}`),
                    kvRow(t('facts_signals'), `${facts.length} / ${signals.length}`),
                    h('div', { class: 'sheet-note', style: 'margin-top:8px' }, t('two_writes_note')),
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
                          if (!created || !created.personId) throw new Error(t('create_failed'));
                          await commit(created.personId, res.displayName);
                          sheet.overlay.remove();
                          ctx.toast(`${t('new_person_saved')}${created.personId}`, 'ok');
                          if (onDone) onDone();
                        } catch (err) { busy(bb, false, t('confirm_create_save')); sheet.showErr(err.message); }
                      },
                    }, t('confirm_create_save')),
                  ]),
                ]));
                return;
              }
              await commit(picked.id, picked.displayName || picked.display_name);
              sheet.overlay.remove();
              ctx.toast(t('interaction_saved'), 'ok');
              if (onDone) onDone();
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
