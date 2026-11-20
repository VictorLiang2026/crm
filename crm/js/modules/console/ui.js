// Console 公共 UI 件（WP1）：页面骨架、加载/错误/空态、徽标与格式化。
// 所有业务数据均由 data.js 经既有云函数只读取得；本文件不含任何云调用。
import { h } from './dom.js';
import { ic } from './icons.js';
import { t } from './i18n.js';

export function isCompactViewport() {
  return window.matchMedia('(max-width: 767px), (max-height: 520px) and (pointer: coarse)').matches;
}

export function confirmDiscardDraft() {
  return window.confirm(t('mobile_draft_discard'));
}

export function workflowSteps(labels, current) {
  return h('ol', { class: 'mobile-workflow-steps' }, labels.map((label, index) =>
    h('li', { 'aria-current': index === current ? 'step' : undefined }, [String(index + 1), ' · ', label])));
}

export function selectableBars(entries, label) {
  const status = h('p', { class: 'chart-selection', role: 'status' });
  const magnitude = entry => Number.isFinite(entry.value) && entry.value >= 0 ? entry.value : 0;
  const max = Math.max(1, ...entries.map(magnitude));
  const buttons = entries.map(entry => h('button', {
    type: 'button', class: 'chart-bar', 'aria-pressed': 'false',
    'aria-label': `${entry.label} · ${entry.value ?? '—'}`,
    onclick: event => select(event.currentTarget, entry),
  }, [
    h('span', {}, entry.label),
    h('span', { class: 'chart-track', 'aria-hidden': 'true' },
      h('span', { style: `--chart-fill:${100 * magnitude(entry) / max}%` })),
    h('strong', {}, String(entry.value ?? '—')),
  ]));
  function select(button, entry) {
    buttons.forEach(control => control.setAttribute('aria-pressed', String(control === button)));
    status.textContent = `${entry.label} · ${entry.value ?? '—'}${entry.detail ? ' · ' + entry.detail : ''}`;
  }
  if (entries.length) select(buttons[0], entries[0]);
  return h('section', { class: 'interactive-chart', 'aria-label': label }, [
    status, h('div', { class: 'chart-bars', tabindex: '0', 'aria-label': label }, buttons),
  ]);
}

// ---------- 结构件（沿用 WP0 约定） ----------
export function wpTag(text, hot) {
  return h('span', { class: 'wp-tag' + (hot ? ' hot' : '') }, text);
}
export function sk(width, cls) {
  return h('span', { class: 'sk ' + (cls || ''), style: 'width:' + width });
}
export function skeletonRows(n) {
  return h('div', { class: 'card-body' },
    Array.from({ length: n || 3 }, () =>
      h('div', { class: 'sk-row' }, [sk('34%', 't'), sk('48%')])));
}
export function pageHead({ kicker, title, sub, actions, tag }) {
  return h('div', { class: 'page-head' }, [
    h('div', { class: 'page-head-row' }, [
      h('div', {}, [
        h('div', { class: 'kicker' }, kicker),
        h('h1', { class: 'page-title' }, [title, tag ? h('span', { style: 'margin-left:10px;vertical-align:middle' }, tag) : null]),
        sub ? h('p', { class: 'page-sub' }, sub) : null,
      ]),
      actions && actions.length ? h('div', { class: 'head-actions' }, actions) : null,
    ]),
  ]);
}
export function card({ title, icon, tag, body, foot, cls }) {
  return h('section', { class: 'card ' + (cls || '') }, [
    title ? h('div', { class: 'card-head' }, [icon ? ic(icon) : null, h('b', {}, title), tag ? h('span', { style: 'margin-left:auto' }, tag) : null]) : null,
    body ? (Array.isArray(body) ? h('div', { class: 'card-body' }, body) : h('div', { class: 'card-body' }, [body])) : null,
    foot ? h('div', { class: 'card-foot' }, foot) : null,
  ]);
}
export function emptyNote(title, note) {
  return h('div', { class: 'empty' }, [h('b', {}, title), note]);
}
export function responsiveTable(table, { className = '', titleColumn = 0 } = {}) {
  table.setAttribute('role', 'table');
  table.tHead?.setAttribute('role', 'rowgroup');
  for (const row of table.tHead?.rows || []) {
    row.setAttribute('role', 'row');
    for (const header of row.cells) header.setAttribute('role', 'columnheader');
  }
  const headers = [...(table.tHead?.rows[0]?.cells || [])];
  for (const body of table.tBodies) {
    body.setAttribute('role', 'rowgroup');
    for (const row of body.rows) {
      row.setAttribute('role', 'row');
      if (row.cells.length !== headers.length) continue;
      for (const [index, cell] of [...row.cells].entries()) {
        cell.setAttribute('role', cell.scope === 'row' ? 'rowheader' : 'cell');
        const label = headers[index].textContent.replace(/\s*[▲▼]\s*$/, '').trim();
        cell.dataset.mobileLabel = index === titleColumn ? '' : label;
        if (index === titleColumn) cell.classList.add('mobile-table-title');
      }
    }
  }
  const key = `${location.hash}:${table.dataset.compareKey || table.className}`;
  const wrap = h('div', { class: `table-scroll ${className}`.trim() }, table);
  const button = h('button', { type: 'button', class: 'btn mobile-compare-toggle' }, t('mobile_compare_table'));
  const host = h('div', { class: 'responsive-table' }, [button, wrap]);
  function setCompare(enabled) {
    host.classList.toggle('is-comparing', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    if (enabled && isCompactViewport()) {
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', t('mobile_compare_table'));
    } else {
      wrap.removeAttribute('tabindex');
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-label');
    }
  }
  setCompare(comparedTable === key);
  button.addEventListener('click', () => {
    const enabled = !host.classList.contains('is-comparing');
    comparedTable = enabled ? key : '';
    setCompare(enabled);
  });
  return host;
}
let comparedTable = '';

export function errorBox(err, onRetry) {
  return h('div', { class: 'error-box' }, [
    h('b', {}, t('data_load_failed')),
    h('p', {}, (err && err.message) ? String(err.message).slice(0, 160) : t('try_later')),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => onRetry() }, [ic('refresh'), t('retry')]),
  ]);
}

// 异步加载：先骨架，成功替换内容，失败显示可重试错误；离开页面后回调写入已分离节点，无副作用。
export function loadInto(el, loader, skele, focusAttribute) {
  if (!focusAttribute) el.replaceChildren(skele || skeletonRows(3));
  // Sorting keeps the previous table usable while the next page is loading.
  function replace(node, failed = false) {
    if (!alive) return;
    const active = document.activeElement;
    const key = focusAttribute && el.contains(active) && active.getAttribute(focusAttribute);
    el.replaceChildren(node);
    if (key) {
      const selector = failed ? 'button' : `[${focusAttribute}="${CSS.escape(key)}"]`;
      el.querySelector(selector)?.focus({ preventScroll: true });
    }
  }
  let alive = true;
  const refresh = () => loadInto(el, loader, skele);
  Promise.resolve()
    .then(loader)
    .then(node => replace(node))
    .catch(err => replace(errorBox(err, refresh), true));
  return () => { alive = false; };
}

// ---------- 徽标 ----------
const TONE_CLASS = { red: 'bdg-red', gold: 'bdg-gold', jade: 'bdg-jade', ink: 'bdg-ink', gray: 'bdg-gray' };
export function bdg(text, tone) {
  return h('span', { class: 'bdg ' + (TONE_CLASS[tone] || 'bdg-gray') }, text);
}
export function avatar(name, gold) {
  const ch = String(name || '?').trim().charAt(0) || '?';
  return h('span', { class: 'pavatar sm' + (gold ? ' gold' : '') }, ch);
}
export function clickableRow(children, href) {
  return h('a', { class: 'list-row data-row', href }, children);
}

// ---------- 键值网格 ----------
export function kvGrid(pairs) {
  const items = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!items.length) return emptyNote(t('empty_no_info'), '');
  return h('dl', { class: 'kv' }, items.flatMap(([k, v]) => [
    h('dt', {}, k), h('dd', {}, String(v)),
  ]));
}
export function sectionTitle(text, tagNode) {
  return h('div', { class: 'section-title' }, [h('b', {}, text), tagNode || null]);
}

// ---------- 格式化（输入为 YYYY-MM-DD / ISO 字符串，均按证据保守处理） ----------
export function textOf(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[2])}${t('month_suffix')}${Number(m[3])}${t('day_suffix')}` : (s ? String(s).slice(0, 10) : '');
}
export function weekdayCN(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  return t('weekday_prefix') + t('weekday_' + new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay());
}
function localDay(d) {
  // 以北京时间（UTC+8）计算日差，与服务端 horizon 口径一致。
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return new Date(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate());
}
export function dayDiffFromToday(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = localDay(new Date());
  return Math.round((target - now) / 86400000);
}
export function dueLabel(s) {
  const diff = dayDiffFromToday(s);
  if (diff === null) return t('no_date');
  if (diff < 0) return `${t('overdue')} ${-diff} ${t('day_unit')}`;
  if (diff === 0) return t('today');
  if (diff === 1) return t('tomorrow');
  if (diff <= 7) return `${diff} ${t('days_later')}`;
  return fmtDate(s);
}
export function toneByDue(s) {
  const diff = dayDiffFromToday(s);
  if (diff === null) return 'gray';
  if (diff < 0) return 'red';
  if (diff <= 1) return 'gold';
  return 'ink';
}
