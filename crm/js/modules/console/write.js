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
const OPP_TYPE_CN = {
  insurance: '保障', recruit: '增员', referral: '转介绍', activity: '活动',
  speaker: '嘉宾', partnership: '合作', service: '服务', relationship: '关系维护',
};
const STAGE_OPTIONS = ['发现', '沟通', '方案', '潜在线索', '已介绍', '已联系', '已建立关系'];
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- Bottom Sheet 骨架 ----------
export function openSheet({ title, sub, body }) {
  const errBox = h('div', { class: 'sheet-err', style: 'display:none' });
  const bodyEl = h('div', {}, [body, errBox]);
  const overlay = h('div', { class: 'sheet-overlay' }, [
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, [
      h('div', { class: 'sheet-head' }, [
        h('b', { class: 'sheet-title' }, title),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '关闭',
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
  const titleText = kind === 'action' ? (row.title || '未命名行动') : (row.content || '未填写承诺');
  const body = h('div', {}, [
    h('p', { class: 'sheet-note', style: 'margin:0 0 10px' },
      '先由服务端核对当前状态并生成预览，你确认后才写入完成状态。'),
  ]);
  const sheet = openSheet({ title: kind === 'action' ? '完成行动' : '完成承诺', sub: titleText, body });
  document.body.appendChild(sheet.overlay);
  (async () => {
    const res = await p360(ctx, 'previewWorkItem', { data: {
      idempotencyKey: uuid(), kind, operation: 'complete',
      personId: String(row.person_id), itemId: String(row.id), draft: {},
    } });
    const pv = res.preview || {};
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow('对象', pv.personName || ''),
        kvRow('内容', titleText),
        kvRow('到期', row.due_at ? dueLabel(String(row.due_at).slice(0, 10)) : ''),
        h('div', { class: 'kv-line' }, [
          h('span', { class: 'kv-k' }, '状态'), bdg('待完成', 'gold'), h('span', {}, ' → '), bdg('已完成', 'jade'),
        ]),
        res.expiresAt ? h('div', { class: 'sheet-note', style: 'margin-top:8px' },
          `预览有效期至 ${fmtDate(String(res.expiresAt).slice(0, 10))}，超时后需重新预览。`) : null,
      ]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            busy(btn, true, '写入中…');
            try {
              await p360(ctx, 'executeWorkItem', { previewId: res.previewId });
              sheet.overlay.remove();
              ctx.toast(kind === 'action' ? '行动已完成' : '承诺已履行', 'ok');
              if (onDone) onDone();
            } catch (err) { busy(btn, false, '确认完成'); sheet.showErr(err.message); }
          },
        }, '确认完成'),
      ]),
    ]));
  })().catch((err) => {
    sheet.swap(h('div', {}, [h('div', { class: 'sheet-err' },
      (err.message || '').includes('state changed')
        ? '该条目状态已变化（可能已完成或取消），请刷新列表后重试。'
        : (err.message || '预览失败'))]));
  });
}

// ---------- 机会：推进 / 关闭 ----------
export function openOpportunityAdvance(ctx, { opportunity, personName, onDone }) {
  const status = opportunity.status || '发现';
  const modeSel = sel([['stage', '推进阶段'], ['close', '关闭 / 成交']], 'stage');
  const stageSel = sel(STAGE_OPTIONS.filter((s) => s !== status).map((s) => [s, s]), '沟通');
  const closeSel = sel([['成交', '成交'], ['关闭', '关闭']], '成交');
  const resultTa = h('textarea', { class: 'sheet-textarea', placeholder: '必填：记录本次结果（Outcome），≤4000 字' });
  const form = h('div', {}, [
    fieldRow('操作', modeSel),
    h('div', { id: 'opp-stage-wrap' }, [fieldRow('推进到', stageSel,
      `当前阶段：${status}；阶段不由 AI 自动推进`)]),
    h('div', { id: 'opp-close-wrap', style: 'display:none' }, [
      fieldRow('结果', closeSel),
      fieldRow('结果说明', resultTa, '服务端会核对机会状态未变；关闭同时记录 Outcome。'),
    ]),
  ]);
  const sheet = openSheet({
    title: '推进 / 关闭机会',
    sub: `${OPP_TYPE_CN[opportunity.opportunity_type] || opportunity.opportunity_type || '机会'} · ${personName || ''}`,
    body: h('div', {}, [
      h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, '先预览变更，确认后才写入。'),
      form,
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doPreview(e.currentTarget) }, '生成预览'),
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
    busy(btn, true, '预览中…');
    const draft = modeSel.value === 'stage' ? { status: stageSel.value }
      : { actionId: null, status: closeSel.value, result: resultTa.value.trim() };
    try {
      if (modeSel.value === 'close' && !draft.result) throw new Error('请填写结果说明（Outcome）');
      const res = await p360(ctx, 'previewOpportunity', { data: {
        idempotencyKey: uuid(), operation: modeSel.value,
        personId: String(opportunity.person_id || opportunity.person?.id || ''),
        opportunityId: String(opportunity.id), draft,
      } });
      renderConfirm(res, draft);
    } catch (err) { busy(btn, false, '生成预览'); sheet.showErr(err.message); }
  }
  function renderConfirm(res, draft) {
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow('对象', (res.preview && res.preview.personName) || personName || ''),
        kvRow('内容', `${OPP_TYPE_CN[opportunity.opportunity_type] || '机会'}（${status}）`),
        h('div', { class: 'kv-line' }, [
          h('span', { class: 'kv-k' }, '变更'),
          bdg(status, 'gray'), h('span', {}, ' → '),
          bdg(draft.status, draft.status === '成交' ? 'jade' : 'gold'),
        ]),
        draft.result ? kvRow('结果说明', draft.result.slice(0, 120)) : null,
        h('div', { class: 'sheet-note', style: 'margin-top:8px' }, '预览不写业务数据；执行后立即生效。'),
      ]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            busy(btn, true, '写入中…');
            try {
              await p360(ctx, 'executeOpportunity', { previewId: res.previewId });
              sheet.overlay.remove();
              ctx.toast(draft.status === '成交' ? '恭喜，机会已成交' : '机会已更新', 'ok');
              if (onDone) onDone();
            } catch (err) { busy(btn, false, '确认执行'); sheet.showErr(err.message); }
          },
        }, '确认执行'),
      ]),
    ]));
  }
}

// ---------- 机会：新建 ----------
export function openOpportunityCreate(ctx, { onDone }) {
  const nameInput = h('input', { class: 'sheet-input', placeholder: '输入完整姓名，点「搜索 Person」' });
  const searchBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => doSearch() }, '搜索 Person');
  const candBox = h('div', {});
  const typeSel = sel(OPP_TYPES.map((t) => [t, OPP_TYPE_CN[t]]), 'insurance');
  const progressTa = h('textarea', { class: 'sheet-textarea', placeholder: '当前进展（≤4000 字）' });
  const nextInput = h('input', { class: 'sheet-input', placeholder: '下一步动作（≤1000 字）' });
  const dateInput = h('input', { class: 'sheet-input', type: 'date' });
  let picked = null;
  const sheet = openSheet({
    title: '新建机会', sub: '先核对 Person，再填写机会信息；预览确认后才写入。',
    body: h('div', {}, [
      fieldRow('关联 Person', h('div', { style: 'display:flex;gap:8px' }, [nameInput, searchBtn])),
      candBox,
      fieldRow('机会类型', typeSel),
      fieldRow('当前进展', progressTa),
      fieldRow('下一步', nextInput),
      fieldRow('下一步日期', dateInput, '可留空 = 暂不排期'),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doPreview(e.currentTarget) }, '生成预览'),
      ]),
    ]),
  });
  document.body.appendChild(sheet.overlay);
  async function doSearch() {
    const name = nameInput.value.trim();
    candBox.replaceChildren(h('div', { class: 'sheet-note' }, '搜索中…'));
    if (!name) { candBox.replaceChildren(h('div', { class: 'sheet-note' }, '请输入姓名')); return; }
    try {
      const res = await p360(ctx, 'search', { name });
      const rows = res.candidates || [];
      if (!rows.length) { candBox.replaceChildren(h('div', { class: 'sheet-err' }, '未找到同名 Person')); return; }
      picked = rows.length === 1 ? rows[0] : null;
      candBox.replaceChildren(rows.map((c) => h('div', {
        class: 'cand' + (rows.length === 1 ? ' active' : ''),
        onclick: (e) => {
          picked = c;
          candBox.querySelectorAll('.cand').forEach((n) => n.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }, `${c.display_name || c.displayName}（${c.occupation || '职业未填'} · ${c.organization || '机构未填'}）#${c.id}`)),
      h('div', { class: 'sheet-note', style: 'margin-top:6px' },
        rows.length === 1 ? '已自动选定唯一候选' : '请点选明确的 Person'));
    } catch (err) { candBox.replaceChildren(h('div', { class: 'sheet-err' }, err.message)); }
  }
  async function doPreview(btn) {
    sheet.showErr('');
    if (!picked) { sheet.showErr('请先搜索并点选 Person'); return; }
    if (!progressTa.value.trim()) { sheet.showErr('请填写当前进展'); return; }
    if (!nextInput.value.trim()) { sheet.showErr('请填写下一步'); return; }
    busy(btn, true, '预览中…');
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
          kvRow('Person', `${picked.display_name || picked.displayName} #${picked.id}`),
          kvRow('类型', OPP_TYPE_CN[typeSel.value]),
          kvRow('进展', progressTa.value.trim().slice(0, 120)),
          kvRow('下一步', `${nextInput.value.trim()}${dateInput.value ? ' · ' + dateInput.value : ''}`),
          h('div', { class: 'sheet-note', style: 'margin-top:8px' }, '新机会将进入「发现」阶段。'),
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
          h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: async (e) => {
              const b = e.currentTarget;
              busy(b, true, '写入中…');
              try {
                await p360(ctx, 'executeOpportunity', { previewId: res.previewId });
                sheet.overlay.remove();
                ctx.toast('机会已创建', 'ok');
                if (onDone) onDone();
              } catch (err) { busy(b, false, '确认创建'); sheet.showErr(err.message); }
            },
          }, '确认创建'),
        ]),
      ]));
    } catch (err) { busy(btn, false, '生成预览'); sheet.showErr(err.message); }
  }
}

// ---------- 机会候选：三键（编辑 / 拒绝 / 接受并建机会） ----------
export function openCandidate(ctx, { row, onDone }) {
  const body = h('div', {}, [h('div', { class: 'sheet-note' }, '正在生成服务端预览…')]);
  const sheet = openSheet({
    title: '审核机会候选',
    sub: `${row.personName || ''} · 候选 #${row.id}`,
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
    typeSel = sel(OPP_TYPES.map((t) => [t, OPP_TYPE_CN[t]]), d.opportunity_type || 'insurance');
    reasonTa = h('textarea', { class: 'sheet-textarea' }, d.reason || '');
    nextTa = h('textarea', { class: 'sheet-textarea' }, d.next_action || '');
    const evidence = preview.evidence || [];
    sheet.swap(h('div', {}, [
      previewBlock([
        kvRow('Person', (preview.person && `${preview.person.displayName} #${preview.person.id}`) || row.personName || ''),
        h('div', { class: 'sheet-note', style: 'margin-top:6px' },
          'AI 候选仅供参考；接受后才创建真实机会（进入「发现」阶段）。'),
      ]),
      fieldRow('机会类型', typeSel),
      fieldRow('理由（进展依据）', reasonTa),
      fieldRow('建议下一步', nextTa),
      evidence.length ? h('div', { class: 'sheet-field' }, [
        h('label', {}, '依据（原文引用）'),
        h('ul', { class: 'sheet-evidence' }, evidence.slice(0, 6).map((x) => h('li', {}, String(x)))),
      ]) : null,
      expiresAt ? h('div', { class: 'sheet-note' }, `预览有效期至 ${fmtDate(String(expiresAt).slice(0, 10))}；修改草稿后需重新预览。`) : null,
      h('div', { class: 'sheet-actions' }, [
        h('button', {
          class: 'btn btn-ghost', type: 'button', style: 'color:var(--red)',
          onclick: async (e) => {
            const b = e.currentTarget;
            busy(b, true, '…');
            try {
              await assistant(ctx, { action: 'opportunityCandidate', operation: 'reject', candidateId: row.id });
              sheet.overlay.remove();
              ctx.toast('已拒绝该候选', 'ok');
              if (onDone) onDone();
            } catch (err) { busy(b, false, '拒绝'); sheet.showErr(err.message); }
          },
        }, '拒绝'),
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
              busy(b, false, '保存编辑');
              ctx.toast('草稿已更新，请再次确认', 'ok');
            } catch (err) { busy(b, false, '保存编辑'); sheet.showErr(err.message); }
          },
        }, '保存编辑'),
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
                busy(b, false, '接受并建机会');
                sheet.showErr('草稿已修改，已重新预览；请核对后再次点击「接受并建机会」');
                return;
              }
              await assistant(ctx, { action: 'opportunityCandidate', operation: 'confirm', candidateId: row.id, previewHash: hash });
              const done = await assistant(ctx, { action: 'opportunityCandidate', operation: 'execute', candidateId: row.id });
              sheet.overlay.remove();
              ctx.toast(done && done.opportunityId ? `机会已创建 #${done.opportunityId}` : '机会已创建', 'ok');
              if (onDone) onDone();
            } catch (err) { busy(b, false, '接受并建机会'); sheet.showErr(err.message); }
          },
        }, '接受并建机会'),
      ]),
    ]));
  }
}

// ---------- 快速记录（Quick Capture，生产链路） ----------
export function openQuickCapture(ctx, { personId, onDone } = {}) {
  const ta = h('textarea', {
    class: 'sheet-textarea', style: 'min-height:96px',
    placeholder: '像说话一样记下这次交流，例如：今天和王总吃饭，他说孩子明年去美国读大学，对教育金感兴趣，让我十月后再联系。',
  });
  const parseBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => doParse(e.currentTarget) }, 'AI 理解 →');
  const sheet = openSheet({
    title: '快速记录',
    sub: 'AI 只拆解和匹配人物；保存前由你逐项确认，AI 不会自动改阶段或建机会。',
    body: h('div', {}, [ta, h('div', { class: 'sheet-actions' }, [parseBtn])]),
  });
  document.body.appendChild(sheet.overlay);
  async function doParse(btn) {
    const text = ta.value.trim();
    if (!text) { sheet.showErr('请先输入要记录的内容'); return; }
    busy(btn, true, 'AI 理解中…（约十几秒）');
    try {
      const r = await aiParse(ctx, { action: 'quick_capture', text });
      busy(btn, false, 'AI 理解 →');
      await renderReview(r, text, btn);
    } catch (err) {
      busy(btn, false, 'AI 理解 →');
      sheet.showErr(`AI 解析失败：${err.message}`);
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
    const hint = fixed ? `已锁定为当前 Person（服务端将再次核对身份）`
      : !p.person_name ? 'AI 未识别出人名，请从候选中选择或先到完整档案建档'
      : resolution && resolution.status === 'available' ? '未找到同名 Person；请先在完整档案（Legacy admin）建立该人物后再记录'
      : candidates.length ? '请点选明确的 Person（服务端已核对同名候选）' : '未找到候选；请先在完整档案建档后再记录';
    const candBox = h('div', {});
    let picked = fixed || null;
    if (candidates.length) {
      candBox.appendChild(h('div', {}, candidates.map((c, i) => h('div', {
        class: 'cand' + (picked && String(picked.id) === String(c.id) ? ' active' : ''),
        onclick: (e) => {
          picked = c;
          candBox.querySelectorAll('.cand').forEach((n) => n.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }, `${c.displayName || c.display_name}（${c.occupation || '职业未填'} · ${c.organization || '机构未填'}）#${c.id}`
        + (i === 0 && !fixed ? '' : '')))));
    } else {
      candBox.appendChild(h('div', { class: 'sheet-err' }, hint));
    }
    const typeSel = sel([['见面', '见面'], ['吃饭', '吃饭'], ['电话', '电话'], ['微信', '微信'],
      ['活动', '活动'], ['其他', '其他']].map(([v, l]) => [v, l]), p.interaction_type || '见面');
    const dateInput = h('input', { class: 'sheet-input', type: 'date', value: p.interaction_date || todayStr() });
    const factList = [];
    const pushFacts = (arr) => (arr || []).forEach((x) => { if (x && String(x).trim()) factList.push(String(x).trim()); });
    pushFacts(p.facts); pushFacts(p.needs); pushFacts(p.interests);
    if (!factList.length) factList.push('');
    const sigList = [];
    const pushSig = (note) => { if (note && String(note).trim()) sigList.push(String(note).trim()); };
    if (p.opportunity && p.opportunity.has) pushSig(`机会信号：${p.opportunity.type || ''} ${p.opportunity.note || ''}`);
    if (p.recruit_signal && p.recruit_signal.has) pushSig(`增员信号：${p.recruit_signal.note || ''}`);
    if (p.referral_signal && p.referral_signal.has) pushSig(`转介绍信号：${p.referral_signal.note || ''}`);
    if (!sigList.length) sigList.push('');
    const factsWrap = listEditor(factList, '事实（发生了什么 / 需求 / 兴趣）', '最多 20 条，每条 ≤500 字');
    const sigsWrap = listEditor(sigList, '信号（AI 判断，仅供记录）', '最多 12 条；不会自动建机会或改阶段');
    const summaryTa = h('textarea', { class: 'sheet-textarea' },
      (p.facts || []).join('；') || '');
    const sheetBody = h('div', {}, [
      fieldRow('交流对象（Person 身份）', candBox, hint),
      h('div', { style: 'display:flex;gap:10px' }, [
        h('div', { class: 'sheet-field', style: 'flex:1' }, [h('label', {}, '方式'), typeSel]),
        h('div', { class: 'sheet-field', style: 'width:170px' }, [h('label', {}, '日期'), dateInput]),
      ]),
      factsWrap,
      sigsWrap,
      fieldRow('互动摘要', summaryTa, '保存到互动时间线；≤2000 字。原话已留存为 rawNote。'),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, '取消'),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            if (!picked) { sheet.showErr('请先点选明确的 Person 身份'); return; }
            const facts = factsWrap.readValues().filter((x) => x.trim()).slice(0, 20);
            const signals = sigsWrap.readValues().filter((x) => x.trim()).slice(0, 12);
            if (facts.some((x) => x.length > 500) || signals.some((x) => x.length > 500)) {
              sheet.showErr('每条事实 / 信号不能超过 500 字'); return;
            }
            busy(b, true, '保存中…');
            try {
              await p360(ctx, 'commitQuickCaptureV2', { data: {
                confirmed: true,
                personId: String(picked.id),
                selectedDisplayName: picked.displayName || picked.display_name,
                interaction: {
                  type: typeSel.value, at: dateInput.value || todayStr(), channel: '',
                  summary: (summaryTa.value || facts.join('；')).slice(0, 2000),
                  rawNote: text,
                },
                facts, signals,
              } });
              sheet.overlay.remove();
              ctx.toast('已记录并保存互动', 'ok');
              if (onDone) onDone();
            } catch (err) {
              busy(b, false, '确认并保存');
              sheet.showErr(String(err.message || '').includes('Selected Person')
                ? '所选 Person 身份已变化，请重新打开并选择' : err.message);
            }
          },
        }, '确认并保存'),
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
          class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '删除',
          onclick: () => { rowEl.remove(); if (!rowsEl.children.length) addRow(''); },
        }, [ic('x')]),
      ]);
      rowsEl.appendChild(rowEl);
    }
    initial.forEach((v) => addRow(v));
    const addBtn = h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:6px',
      onclick: () => addRow(''),
    }, [ic('plus'), '加一条']);
    wrap.appendChild(h('label', {}, label));
    wrap.appendChild(rowsEl);
    wrap.appendChild(addBtn);
    if (note) wrap.appendChild(h('div', { class: 'sheet-note', style: 'margin-top:4px' }, note));
    wrap.readValues = () => Array.from(rowsEl.querySelectorAll('textarea')).map((t) => t.value.trim());
    return wrap;
  }
}
