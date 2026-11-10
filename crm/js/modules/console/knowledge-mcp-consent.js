import {deviceCall,verifyDevice} from '../device-access/transport.js';
import { t, getLang, setLang } from './i18n.js';

const SESSION_TIMEOUT = 5 * 60 * 1000;
const CONFIG = { envId: 'crm-d1gkae8ddc930d151' };
const byId = id => document.getElementById(id);

export function isAllowedAuthorizationCallback(uri) {
  if (typeof uri !== 'string') return false;
  try {
    const target = new URL(uri);
    const chatgpt = target.protocol === 'https:' && target.hostname === 'chatgpt.com' &&
      (target.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]{1,80}$/.test(target.pathname));
    if (chatgpt) return true;
  } catch (_) { return false; }
  const match = uri.match(/^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/callback$/);
  return !!match && (!match[1] || Number(match[1]) <= 65535);
}

export async function initKnowledgeMcpConsent() {
  const params = new URLSearchParams(location.search);
  const state = { app: null, auth: null, ready: false, lastActivity: 0, locked: false };
  function paint() {
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
    document.title = t('kmcp_title');
    for (const [id, key] of [['title','kmcp_title'],['requester','kmcp_requester'],['intro','kmcp_intro'],['read','kmcp_read'],
      ['write','kmcp_write'],['followupRead','kmcp_followup_read'],['followupWrite','kmcp_followup_write'],
      ['followupReview','kmcp_followup_review'],['followupDirectWrite','kmcp_followup_direct_write'],
      ['review','kmcp_review'],['loginTitle','kmcp_login'],['usernameLabel','kmcp_username'],
      ['passwordLabel','kmcp_password'],['signin','kmcp_signin'],['allow','kmcp_allow'],['deny','kmcp_deny'],['lang','kmcp_lang_toggle']]) {
      byId(id).textContent = t(key);
    }
    const requested = new Set((params.get('scope') || '').split(/\s+/));
    byId('read').classList.toggle('hidden', !requested.has('knowledge:read'));
    byId('write').classList.toggle('hidden', !requested.has('knowledge:gpt:submit'));
    byId('followupRead').classList.toggle('hidden', !requested.has('followup:read'));
    byId('followupWrite').classList.toggle('hidden', !requested.has('followup:gpt:submit'));
    byId('followupReview').classList.toggle('hidden', !requested.has('followup:gpt:submit'));
    byId('followupDirectWrite').classList.toggle('hidden', !requested.has('followup:gpt:direct_write'));
  }
  function validRequest() {
    return params.get('response_type') === 'code' && params.get('code_challenge_method') === 'S256' &&
      Boolean(params.get('client_id') && params.get('redirect_uri') && params.get('resource') &&
        params.get('state') && params.get('code_challenge') && params.get('oauth_issuer'));
  }
  function callback(values) {
    const uri = params.get('redirect_uri');
    if (!isAllowedAuthorizationCallback(uri)) throw new Error('Invalid callback');
    const target = new URL(uri);
    for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
    location.replace(target.toString());
  }
  function showError(node) { node.textContent = t('kmcp_error'); }
  function showConsent() {
    byId('login').classList.add('hidden'); byId('consent').classList.remove('hidden'); state.ready = true;
  }
  function sessionIsTrusted(result) {
    const session=result?.data?.session;
    return !result?.error&&!!session&&!!session.user&&session.user.is_anonymous!==true;
  }
  function requireLogin() {
    state.locked = true; state.ready = false;
    byId('consent').classList.add('hidden'); byId('login').classList.remove('hidden');
    if (state.auth?.signOut) state.auth.signOut().catch(() => {});
  }
  function noteActivity() {
    if (!state.ready || state.locked) return;
    const now = Date.now();
    if (state.lastActivity && now - state.lastActivity > SESSION_TIMEOUT) { requireLogin(); return; }
    state.lastActivity = now;
    try { localStorage.setItem('crm_last_activity', String(now)); } catch (_) {}
  }
  async function callFn(name, data) {
    if (name !== 'assistant') throw new Error('Function is outside the consent flow allowlist');
    const result = await deviceCall(state.app,CONFIG.envId,name,data);
    return result?.result;
  }
  async function authorize() {
    if (!state.ready || !validRequest()) return;
    const fields = Object.fromEntries(['client_id','redirect_uri','resource','oauth_issuer','response_type','scope','state','code_challenge','code_challenge_method']
      .map(key => [key, params.get(key) || '']));
    const result = await callFn('assistant', { action: 'knowledgeMcpAuthorize', ...fields });
    if (result?.ok && typeof result.code === 'string') callback({ code: result.code, state: result.state, iss: params.get('oauth_issuer') });
    else showError(byId('consentError'));
  }
  paint(); byId('lang').onclick = () => { setLang(getLang() === 'en' ? 'zh-CN' : 'en'); paint(); };
  try {
    if (!window.cloudbase || !validRequest()) throw new Error('Invalid request');
    state.app = window.cloudbase.init({ env: CONFIG.envId, timeout: 120000 });
    state.auth = state.app.auth({ persistence: 'local' });
    const lastActivity = Number(localStorage.getItem('crm_last_activity') || '0');
    const sessionResult = await state.auth.getSession();
    const hasSession = sessionIsTrusted(sessionResult);
    if (hasSession && lastActivity > 0 && Date.now() - lastActivity <= SESSION_TIMEOUT) {
      await verifyDevice(state.app,CONFIG.envId); state.lastActivity = lastActivity; state.locked = false; showConsent();
    }
    else {
      if (hasSession) state.auth.signOut().catch(() => {});
      byId('login').classList.remove('hidden');
    }
  } catch (_) { showError(byId('consentError')); byId('consent').classList.remove('hidden'); }
  byId('login').addEventListener('submit', async event => {
    event.preventDefault(); const button = byId('signin'); button.disabled = true; button.textContent = t('kmcp_processing'); byId('error').textContent = '';
    try {
      const result = await state.auth.signInWithPassword({ username: byId('username').value.trim(), password: byId('password').value });
      if (result?.error || !sessionIsTrusted(result)) throw result?.error||new Error('Authenticated session required');
      await verifyDevice(state.app,CONFIG.envId); state.lastActivity = Date.now(); state.locked = false; localStorage.setItem('crm_last_activity', String(state.lastActivity)); showConsent();
    } catch (_) { byId('error').textContent = t('kmcp_signin_error'); button.disabled = false; button.textContent = t('kmcp_signin'); }
  });
  byId('allow').onclick = async () => {
    if (!state.ready) return;
    const button = byId('allow'); button.disabled = true; button.textContent = t('kmcp_processing');
    try { await authorize(); } catch (_) { showError(byId('consentError')); button.disabled = false; button.textContent = t('kmcp_allow'); }
  };
  byId('deny').onclick = () => {
    try { callback({ error: 'access_denied', state: params.get('state') || '', iss: params.get('oauth_issuer') || '' }); }
    catch (_) { showError(byId('consentError')); }
  };
  for (const eventName of ['click','keydown','mousedown','touchstart','wheel']) document.addEventListener(eventName,noteActivity,true);
  window.setInterval(() => {
    if (state.ready && state.lastActivity && Date.now() - state.lastActivity > SESSION_TIMEOUT) requireLogin();
  }, 10000);
}
