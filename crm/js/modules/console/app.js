// Console 引导层：复用 admin.html 相同的 CloudBase 认证与会话语义（5 分钟无操作重登录）。
// 仅新增文件，不改动 admin.html；业务调用经 core/createApi 包装（校验函数名、拒绝 pr_*）。
import { createApi } from '../../core/index.js';
import { h, toast } from './dom.js';
import { renderLogin, renderReloginOverlay } from './login.js';
import { mountShell } from './shell.js';
import { navHashFor, dispatch } from './router.js';
import { openQuickCapture } from './write.js';

const CONFIG = window.APP_CONFIG || {};
const SESSION_TIMEOUT = 5 * 60 * 1000; // 与 admin.html 一致
const LAST_KEY = 'crm_last_activity';   // 与 admin.html 共享同一活动时间戳：任一页面活动都算会话活动

let app = null;
let authInst = null;
let api = null;
let loginReady = false;
let shell = null;
let hashBound = false;

let lastActivity = Date.now();
let sessionLocked = false;
let sessionWaiters = [];
let reloginShowing = false;

// ---------- 会话活动持久化（与 admin.html 相同节流：15 秒最多写一次） ----------
function persistActivity(force) {
  try {
    const now = Date.now();
    if (!force && now - (persistActivity.t || 0) < 15000) return;
    persistActivity.t = now;
    localStorage.setItem(LAST_KEY, String(now));
  } catch (e) { /* 隐私模式等场景忽略 */ }
}
try {
  const stored = parseInt(localStorage.getItem(LAST_KEY) || '0', 10);
  if (stored) lastActivity = stored;
} catch (e) { console.warn(e); }

['click', 'mousedown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => {
  window.addEventListener(ev, () => { if (!sessionLocked) { lastActivity = Date.now(); persistActivity(false); } }, true);
});

// ---------- 认证 ----------
function checkAuthResult(result) {
  if (result && result.error) throw result.error;
  return result;
}
async function signIn(username, password) {
  checkAuthResult(await authInst.signInWithPassword({ username, password }));
}
async function callFn(name, data) {
  await ensureSession(); // 超过 5 分钟无操作时，先要求重新登录再继续原操作
  const res = await app.callFunction({ name, data });
  return res.result;
}

function ensureSession() {
  if (!sessionLocked && Date.now() - lastActivity <= SESSION_TIMEOUT) {
    lastActivity = Date.now(); persistActivity(true);
    return Promise.resolve();
  }
  if (!sessionLocked) sessionLocked = true;
  return forceReLogin();
}
function forceReLogin() {
  return new Promise((resolve) => {
    sessionWaiters.push(resolve);
    if (reloginShowing) return;
    reloginShowing = true;
    try { if (authInst && authInst.signOut) authInst.signOut().catch(() => {}); } catch (e) { /* 忽略 */ }
    renderReloginOverlay({
      signIn,
      onOk: () => {
        sessionLocked = false;
        lastActivity = Date.now();
        persistActivity(true);
        const waiters = sessionWaiters; sessionWaiters = []; reloginShowing = false;
        waiters.forEach((r) => { try { r(); } catch (e) { /* 忽略 */ } });
        route();
      },
    });
  });
}
async function signOutCurrentAccount() {
  checkAuthResult(await authInst.signOut());
  loginReady = false;
  try { localStorage.removeItem(LAST_KEY); } catch (e) { console.warn(e); }
  const url = new URL(location.href);
  url.hash = '#/today';
  url.searchParams.set('_fresh', String(Date.now()));
  location.replace(url.href);
}

// ---------- 路由 ----------
function route() {
  if (!loginReady || !shell) return;
  const raw = location.hash || '#/today';
  shell.setActive(navHashFor(raw));
  dispatch(raw, {
    main: shell.main,
    api,
    callFn,
    operator: CONFIG.operator || {},
    toast,
    signOut: signOutCurrentAccount,
  });
}

// ---------- 启动 ----------
function showLogin(appRoot) {
  document.body.classList.add('is-login');
  renderLogin({
    mount: appRoot,
    brand: { name: 'Victor's CRM', tagline: 'RELATIONSHIPS, WITH INTELLIGENCE' },
    signIn,
    onSuccess: () => enterApp(appRoot),
  });
}
function enterApp(appRoot) {
  loginReady = true;
  document.body.classList.remove('is-login');
  lastActivity = Date.now();
  persistActivity(true);
  shell = mountShell({
    appRoot,
    operator: CONFIG.operator || {},
    // WP2 写入闭环：快速记录走生产链路（AI 只读解析 → 服务端身份解析 → 人工确认 → 提交）
    onQuickCapture: () => openQuickCapture(
      { api, callFn, toast, operator: CONFIG.operator || {} },
      { onDone: () => route() },
    ),
  });
  if (!hashBound) {
    hashBound = true;
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
  }
  route();
}
async function init() {
  const appRoot = document.getElementById('app');
  if (!CONFIG.envId) {
    appRoot.replaceChildren(h('div', { class: 'card', style: 'margin:60px auto;max-width:560px;padding:24px' }, [
      h('h3', { style: 'margin:0 0 8px' }, '缺少环境配置'),
      h('p', { class: 'foot-note', style: 'margin:0' }, '请在 console.html 中设置 window.APP_CONFIG.envId 后部署到静态托管。'),
    ]));
    return;
  }
  app = cloudbase.init({ env: CONFIG.envId });
  authInst = app.auth({ persistence: 'local' });
  api = createApi(callFn);
  // 跨刷新 / 后台回收的超时检查（与 admin.html 相同语义）
  try {
    const stored = parseInt(localStorage.getItem(LAST_KEY) || '0', 10);
    if (stored && Date.now() - stored > SESSION_TIMEOUT) {
      try { if (authInst.signOut) authInst.signOut().catch(() => {}); } catch (e) { /* 忽略 */ }
      showLogin(appRoot);
      return;
    }
  } catch (e) { console.warn(e); }
  try {
    if (authInst.hasLoginState && authInst.hasLoginState()) { enterApp(appRoot); return; }
  } catch (e) { console.warn(e); }
  showLogin(appRoot);
}

init();
