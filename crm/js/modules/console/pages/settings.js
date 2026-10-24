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

function passwordField(labelKey, name, autocomplete) {
  const inputId = `console-${name}`;
  const input = h('input', {
    id: inputId, name, type: 'password', autocomplete,
    required: true, class: 'input',
  });
  return {
    input,
    field: h('div', { class: 'settings-password-field' }, [
      h('label', { for: inputId }, t(labelKey)), input,
    ]),
  };
}

function passwordCard(ctx) {
  const oldPassword = passwordField('setting_pwd_old', 'account-old-password', 'current-password');
  const newPassword = passwordField('setting_pwd_new', 'account-new-password', 'new-password');
  const confirmation = passwordField('setting_pwd_confirm', 'account-confirm-password', 'new-password');
  const submit = h('button', {
    class: 'btn btn-ghost btn-sm', type: 'submit',
  }, [ic('lock'), t('setting_password')]);
  const status = h('p', { class: 'form-msg', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'settings-password-form', onsubmit: async (event) => {
    event.preventDefault();
    const oldValue = oldPassword.input.value;
    const newValue = newPassword.input.value;
    const confirmValue = confirmation.input.value;
    status.className = 'form-msg';
    if (!oldValue || !newValue || !confirmValue) {
      status.textContent = t('setting_pwd_required'); return;
    }
    if (newValue.length < 8 || newValue.length > 64) {
      status.textContent = t('setting_pwd_length'); return;
    }
    if (newValue === oldValue) {
      status.textContent = t('setting_pwd_same'); return;
    }
    if (newValue !== confirmValue) {
      status.textContent = t('setting_pwd_mismatch'); return;
    }
    submit.disabled = true;
    status.textContent = t('setting_pwd_pending');
    try {
      await ctx.changePassword(oldValue, newValue);
      status.textContent = t('setting_pwd_success');
    } catch {
      status.classList.add('error');
      status.textContent = t('setting_pwd_fail');
      submit.disabled = false;
    }
  } }, [oldPassword.field, newPassword.field, confirmation.field, submit, status]);
  return card({
    title: t('setting_password'), icon: 'lock',
    body: [
      h('p', { class: 'help' }, t('setting_pwd_help')),
      form,
    ],
  });
}

function maintenanceCard() {
  return card({
    title: t('setting_maintenance'), icon: 'refresh',
    body: [
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => {
          if (!window.confirm(t('setting_reload_confirm'))) return;
          const url = new URL(location.href);
          url.searchParams.set('_fresh', String(Date.now()));
          location.replace(url.href);
        },
      }, [ic('refresh'), t('setting_reload')]),
      h('p', { class: 'foot-note' }, t('setting_reload_note')),
      h('details', { class: 'settings-advanced' }, [
        h('summary', {}, t('setting_advanced_tools')),
        h('p', { class: 'foot-note' }, t('setting_advanced_note')),
        h('div', { class: 'more-actions' }, [
          h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/account' }, t('legacy_account')),
          h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/test-scenario' }, t('legacy_test_scenario')),
        ]),
      ]),
    ],
  });
}

function signOutCard(ctx) {
  const status = h('p', { class: 'form-msg', role: 'status', 'aria-live': 'polite' });
  const button = h('button', {
    class: 'btn btn-ghost', type: 'button', onclick: async () => {
      button.disabled = true;
      status.className = 'form-msg';
      status.textContent = t('setting_signout_pending');
      try {
        await ctx.signOut();
      } catch {
        status.classList.add('error');
        status.textContent = t('setting_signout_fail');
        button.disabled = false;
      }
    },
  }, [ic('log-out'), t('setting_signout')]);
  return card({
    title: t('setting_signout'), icon: 'log-out',
    body: [
      button,
      status,
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
      passwordCard(ctx),
      maintenanceCard(),
      signOutCard(ctx),
    ]),
  );
}
