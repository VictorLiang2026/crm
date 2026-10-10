// Console 壳层：iPad/桌面顶部导航 + iPhone 底部五格（中央凸起记录键）。布局切换由 CSS 媒体查询完成。
import { h } from './dom.js';
import { ic, LOGO_SVG } from './icons.js';
import { t } from './i18n.js';

function navItems() {
  return [
    { hash: '#/today', label: t('nav_today'), icon: 'home' },
    { hash: '#/people', label: t('nav_people'), icon: 'users' },
    { hash: '#/opportunities', label: t('nav_opportunities'), icon: 'target' },
    { hash: '#/activities', label: t('nav_activities'), icon: 'calendar' },
    { hash: '#/recruit', label: t('nav_recruit'), icon: 'recruit' },
    { hash: '#/ai', label: t('nav_ai'), icon: 'sparkle' },
    { hash: '#/more', label: t('nav_more'), icon: 'grid' },
  ];
}
// 手机底栏五格：今日 / 人物 / [记录] / 机会 / 更多；活动、招募、AI 由「更多」进入。
function phoneTabs() {
  const NAV = navItems();
  return [NAV[0], NAV[1], null, NAV[2], NAV[6]];
}

export function mountShell({ appRoot, operator, onQuickCapture }) {
  const initial = String((operator && operator.name) || 'V').trim().charAt(0).toUpperCase() || 'V';
  const brand = h('a', { class: 'brand', href: '#/today' }, [
    h('span', { class: 'brand-logo', html: LOGO_SVG }),
    h('span', {}, ['Victor’s CRM', h('small', {}, 'RELATIONSHIPS, WITH INTELLIGENCE')]),
  ]);
  const NAV_KEYS = { '#/today': 'nav_today', '#/people': 'nav_people', '#/opportunities': 'nav_opportunities', '#/activities': 'nav_activities', '#/recruit': 'nav_recruit', '#/ai': 'nav_ai', '#/more': 'nav_more' };
  const nav = h('nav', { class: 'console-nav' }, navItems().map((n) =>
    h('a', { class: 'nav-item', 'data-nav': n.hash, href: n.hash }, [ic(n.icon), h('span', { 'data-i18n': NAV_KEYS[n.hash] }, n.label)])));
  const topbar = h('header', { class: 'console-topbar' }, [
    brand,
    nav,
    h('div', { class: 'topbar-right' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: onQuickCapture }, [ic('mic'), h('span', { 'data-i18n': 'nav_quick_record' }, t('nav_quick_record'))]),
      h('span', { class: 'avatar', title: (operator && operator.name) || '' }, initial),
    ]),
  ]);
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': t('nav_quick_record'), 'data-i18n-aria': 'nav_quick_record', onclick: onQuickCapture }, [ic('plus')]);
  const tabbar = h('nav', { class: 'console-tabbar' }, phoneTabs().map((slot) => slot
    ? h('a', { class: 'tab-item', 'data-nav': slot.hash, href: slot.hash }, [ic(slot.icon), h('span', { 'data-i18n': NAV_KEYS[slot.hash] }, slot.label)])
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
