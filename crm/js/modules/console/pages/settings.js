// 设置页（i18n）：语言切换 + 账号维护（从 admin.html 迁移）。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { t, getLang, setLang } from '../i18n.js';
import { pageHead, card, emptyNote, kvGrid } from '../ui.js';

function langToggle() {
  const cur = getLang();
  const opts = [
    { code: 'zh-CN', label: t('setting_zh') },
    { code: 'en', label: t('setting_en') },
  ];
  return h('div', { class: 'lang-toggle' }, opts.map(o => {
    const active = o.code === cur;
    const btn = h('button', {
      class: 'btn lang-btn' + (active ? ' active' : ''),
      type: 'button',
      onclick: () => {
        if (getLang() === o.code) return;
        // Immediate visual feedback
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.innerHTML = '';
        btn.append(ic('check'), ' ' + o.label);
        setLang(o.code);
        // Reload current view after brief delay for visual confirmation
        setTimeout(() => { const ev = new Event('popstate'); window.dispatchEvent(ev); }, 300);
      },
    }, active ? [ic('check'), ' ' + o.label] : [o.label]);
    return btn;
  }));
}

function passwordCard() {
  let msg = '';
  const btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
    const { callFn } = await import('../data.js');
    const r = await callFn('requestPasswordReset', {});
    msg = r && r.ok ? t('setting_pwd_sent') : t('setting_pwd_fail');
    status.textContent = msg;
  } }, [ic('lock'), t('setting_password')]);
  const status = h('p', { class: 'form-msg' });
  return card({
    title: t('setting_password'), icon: 'lock',
    body: [
      h('p', { class: 'help' }, t('setting_pwd_help')),
      h('div', { class: 'form-row' }, [btn, status]),
    ],
  });
}

function maintenanceCard() {
  return card({
    title: t('setting_maintenance'), icon: 'refresh',
    body: [
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => { try { localStorage.removeItem('console__init_ts'); } catch (_) {} location.reload(true); },
      }, [ic('refresh'), t('setting_reload')]),
    ],
  });
}

function signOutCard() {
  return card({
    title: t('setting_signout'), icon: 'log-out',
    body: [
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => {
          try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
          location.href = 'console.html';
        },
      }, [ic('log-out'), t('setting_signout')]),
    ],
  });
}

export function renderSettings(ctx) {
  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_settings'), title: t('title_settings'),
      sub: t('sub_settings') || '',
    }),
    h('div', { class: 'page-grid' }, [
      card({ title: t('setting_language'), icon: 'globe', body: [langToggle()] }),
      passwordCard(),
      maintenanceCard(),
      signOutCard(),
    ]),
  );
}
