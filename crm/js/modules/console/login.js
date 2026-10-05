// 登录 / 重新登录视图：复用 admin.html 相同的 CloudBase 用户名密码认证，仅更换界面。
import { h, toast } from './dom.js';
import { LOGO_SVG } from './icons.js';

export function renderLogin({ mount, brand, signIn, onSuccess }) {
  const msg = h('div', { class: 'form-msg', role: 'alert' });
  const u = h('input', { type: 'text', name: 'username', placeholder: '用户名', autocomplete: 'username' });
  const p = h('input', { type: 'password', name: 'password', placeholder: '密码', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, '登 录');
  const form = h('form', { class: 'login-card' }, [
    h('h2', { class: 'login-title' }, '欢迎回来'),
    h('p', { class: 'login-hint' }, '使用云开发平台账号登录（与 admin.html 相同）'),
    h('div', { class: 'field' }, [h('label', {}, '用户名'), u]),
    h('div', { class: 'field' }, [h('label', {}, '密码'), p]),
    btn,
    msg,
    h('p', { class: 'login-foot' }, '5 分钟无操作需重新登录 · 本页为控制台骨架（WP0），业务数据按排期接入'),
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!u.value.trim() || !p.value) { msg.textContent = '请输入用户名和密码'; return; }
    btn.disabled = true; btn.textContent = '登录中…'; msg.textContent = '';
    try {
      await signIn(u.value.trim(), p.value);
      onSuccess();
    } catch (e) {
      msg.textContent = '登录失败：' + (e.message || e);
      btn.disabled = false; btn.textContent = '登 录';
    }
  });
  const hero = h('div', { class: 'login-hero' }, [
    h('div', { class: 'brand brand-light' }, [
      h('span', { class: 'brand-logo', html: LOGO_SVG }),
      h('span', {}, [brand.name, h('small', {}, brand.tagline)]),
    ]),
    h('div', { class: 'login-hero-main' }, [
      h('h1', {}, ['把关系看清，', h('br'), '把下一步做好。']),
      h('p', { class: 'login-sub' }, '以人物为中心的保险经营台：今日行动、承诺与机会按优先级排好，每一条 AI 建议都带来源、经你确认。'),
    ]),
    h('ul', { class: 'login-points' }, [
      h('li', {}, '事实 / 信号 / 推断分层，证据不足时明确说「暂不能判断」'),
      h('li', {}, '自然语言命令走 Command → Plan → Preview → Confirm → Execute'),
      h('li', {}, '机会与身份先成候选，人工确认后才进入业务'),
    ]),
  ]);
  mount.replaceChildren(h('div', { class: 'login' }, [hero, h('div', { class: 'login-form' }, form)]));
  setTimeout(() => u.focus(), 60);
}

export function renderReloginOverlay({ signIn, onOk }) {
  const msg = h('div', { class: 'form-msg' });
  const u = h('input', { type: 'text', name: 'username', placeholder: '用户名', autocomplete: 'username' });
  const p = h('input', { type: 'password', name: 'password', placeholder: '密码', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, '登录');
  const form = h('form', {}, [
    h('div', { class: 'field' }, [h('label', {}, '用户名'), u]),
    h('div', { class: 'field' }, [h('label', {}, '密码'), p]),
    btn,
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!u.value.trim() || !p.value) { msg.textContent = '请输入用户名和密码'; return; }
    btn.disabled = true; btn.textContent = '登录中…'; msg.textContent = '';
    try {
      await signIn(u.value.trim(), p.value);
      overlay.remove();
      toast('已重新登录');
      onOk();
    } catch (e) {
      msg.textContent = '登录失败：' + (e.message || e);
      btn.disabled = false; btn.textContent = '登录';
    }
  });
  const overlay = h('div', { class: 'modal-overlay' }, [
    h('div', { class: 'modal' }, [
      h('h3', { style: 'margin:0 0 6px' }, '会话已超时，请重新登录'),
      h('p', { class: 'login-hint', style: 'margin:0 0 14px' }, '系统超过 5 分钟无操作，为保障数据安全请使用云开发平台账号重新登录。'),
      form,
      msg,
    ]),
  ]);
  document.body.appendChild(overlay);
  setTimeout(() => u.focus(), 60);
}
