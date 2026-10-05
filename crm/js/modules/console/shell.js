// Console 壳层：iPad/桌面顶部导航 + iPhone 底部五格（中央凸起记录键）。布局切换由 CSS 媒体查询完成。
import { h } from './dom.js';
import { ic, LOGO_SVG } from './icons.js';

const NAV = [
  { hash: '#/today', label: '今日', icon: 'home' },
  { hash: '#/people', label: '人物', icon: 'users' },
  { hash: '#/opportunities', label: '机会', icon: 'target' },
  { hash: '#/activities', label: '活动', icon: 'calendar' },
  { hash: '#/recruit', label: '招募', icon: 'recruit' },
  { hash: '#/ai', label: 'AI 助手', icon: 'sparkle' },
  { hash: '#/more', label: '更多', icon: 'grid' },
];
// 手机底栏五格：今日 / 人物 / [记录] / 机会 / 更多；活动、招募、AI 由「更多」进入。
const PHONE_TABS = [NAV[0], NAV[1], null, NAV[2], NAV[6]];

export function mountShell({ appRoot, operator, onQuickCapture }) {
  const initial = String((operator && operator.name) || 'V').trim().charAt(0).toUpperCase() || 'V';
  const brand = h('a', { class: 'brand', href: '#/today' }, [
    h('span', { class: 'brand-logo', html: LOGO_SVG }),
    h('span', {}, ['Victor’s CRM', h('small', {}, 'RELATIONSHIPS, WITH INTELLIGENCE')]),
  ]);
  const nav = h('nav', { class: 'console-nav' }, NAV.map((n) =>
    h('a', { class: 'nav-item', 'data-nav': n.hash, href: n.hash }, [ic(n.icon), n.label])));
  const topbar = h('header', { class: 'console-topbar' }, [
    brand,
    nav,
    h('div', { class: 'topbar-right' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: onQuickCapture }, [ic('mic'), '快速记录']),
      h('span', { class: 'avatar', title: (operator && operator.name) || '' }, initial),
    ]),
  ]);
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': '快速记录', onclick: onQuickCapture }, [ic('plus')]);
  const tabbar = h('nav', { class: 'console-tabbar' }, PHONE_TABS.map((slot) => slot
    ? h('a', { class: 'tab-item', 'data-nav': slot.hash, href: slot.hash }, [ic(slot.icon), h('span', {}, slot.label)])
    : h('div', { class: 'fab-slot' }, fab)));
  const main = h('main', { class: 'console-main', id: 'console-main' });
  appRoot.replaceChildren(topbar, main, tabbar);
  return {
    main,
    setActive(navHash) {
      document.querySelectorAll('[data-nav]').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('data-nav') === navHash);
      });
    },
  };
}
