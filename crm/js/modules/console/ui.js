// Console 公共 UI 件（WP1）：页面骨架、加载/错误/空态、徽标与格式化。
// 所有业务数据均由 data.js 经既有云函数只读取得；本文件不含任何云调用。
import { h } from './dom.js';
import { ic } from './icons.js';

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
export function errorBox(err, onRetry) {
  return h('div', { class: 'error-box' }, [
    h('b', {}, '数据加载失败'),
    h('p', {}, (err && err.message) ? String(err.message).slice(0, 160) : '请稍后重试'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => onRetry() }, [ic('refresh'), '重试']),
  ]);
}

// 异步加载：先骨架，成功替换内容，失败显示可重试错误；离开页面后回调写入已分离节点，无副作用。
export function loadInto(el, loader, skele) {
  el.replaceChildren(skele || skeletonRows(3));
  let alive = true;
  const refresh = () => loadInto(el, loader, skele);
  Promise.resolve()
    .then(loader)
    .then((node) => { if (alive) el.replaceChildren(node); })
    .catch((err) => { if (alive) el.replaceChildren(errorBox(err, refresh)); });
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
  if (!items.length) return emptyNote('暂无资料', '');
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
  return m ? `${Number(m[2])}月${Number(m[3])}日` : (s ? String(s).slice(0, 10) : '');
}
export function weekdayCN(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  return '周' + '日一二三四五六'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
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
  if (diff === null) return '无日期';
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff <= 7) return `${diff} 天后`;
  return fmtDate(s);
}
export function toneByDue(s) {
  const diff = dayDiffFromToday(s);
  if (diff === null) return 'gray';
  if (diff < 0) return 'red';
  if (diff <= 1) return 'gold';
  return 'ink';
}
