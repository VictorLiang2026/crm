import { registrationCall } from './console/registration-call.js';
import { getLang, setLang, t } from './console/i18n.js';

const config = window.APP_CONFIG || {};
const root = document.getElementById('activity-registration');
document.title = t('ar_title');
const app = window.cloudbase.init({ env: config.envId, accessKey: config.accessKey, timeout: 20000 });
const api = (action, data = {}) => registrationCall(async payload=>{
  const reply=await app.callFunction({name: 'activity_registration_public',data:payload});
  return reply?.result ?? reply;
},action,data);
const safeImage = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const statusKeys = { pending: 'ar_status_pending', approved: 'ar_status_approved', rejected: 'ar_status_rejected', waitlisted: 'ar_status_waitlisted' };
let currentPage = null;
let managed = null;
let credentialToken = '';

function node(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null) return;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, String(value));
  });
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function field(label, input, required = false) {
  const wrapper = node('label', { class: 'ar-field' });
  wrapper.append(node('span', {}, `${label}${required ? ' *' : ''}`), input);
  return wrapper;
}

function createInput(type, value = '', placeholder = '') {
  const input = node('input', { type, value, placeholder, autocomplete: type === 'tel' ? 'tel' : 'off' });
  return input;
}

function formFields(schema, values = {}) {
  const controls = new Map();
  const fields = (schema || []).map(item => {
    let input;
    if (item.type === 'textarea') input = node('textarea', { maxlength: '1000' }, values[item.key] || '');
    else if (item.type === 'select') {
      input = node('select');
      input.append(node('option', { value: '' }, t('ar_choose')));
      (item.options || []).forEach(option => input.append(node('option', { value: option, selected: values[item.key] === option }, option)));
    } else input = createInput('text', values[item.key] || '', item.label);
    input.name = item.key;
    if (item.required) input.required = true;
    controls.set(item.key, input);
    return field(item.label, input, item.required);
  });
  return { fields, controls };
}

function renderTop() {
  const top = node('div', { class: 'ar-top' }, [node('span', {}, t('ar_brand'))]);
  top.append(node('button', { class: 'ar-lang', type: 'button', onclick: () => { setLang(getLang() === 'zh-CN' ? 'en' : 'zh-CN'); document.title=t('ar_title'); render(); } },
    getLang() === 'zh-CN' ? t('ar_language_english') : t('ar_language_chinese')));
  return top;
}

function showUnavailable(message = t('ar_unavailable')) {
  root.replaceChildren(node('div', { class: 'ar-shell' }, [renderTop(), node('section', { class: 'ar-unavailable' }, [
    node('span', { class: 'ar-kicker' }, t('ar_brand')), node('h1', {}, t('ar_unavailable_title')), node('p', {}, message),
  ])]));
}

function renderEvent(page) {
  const content = page.content || {};
  const event = page.activity || {};
  const hero = node('header', { class: 'ar-hero' });
  const cover = safeImage(content.coverUrl);
  if (cover) hero.append(node('img', { src: cover, alt: '', loading: 'eager', referrerpolicy: 'no-referrer' }));
  hero.append(node('div', { class: 'ar-hero-copy' }, [node('span', { class: 'ar-kicker' }, t('ar_invitation')), node('h1', { class: 'ar-title' }, content.title || event.name || t('ar_title'))]));
  const facts = node('div', { class: 'ar-facts' }, [
    node('div', { class: 'ar-fact' }, [node('span', { class: 'ar-label' }, t('ar_when')), node('strong', {}, event.activity_date || t('ar_to_be_announced'))]),
    node('div', { class: 'ar-fact' }, [node('span', { class: 'ar-label' }, t('ar_where')), node('strong', {}, event.location || t('ar_to_be_announced'))]),
  ]);
  const story = node('section', { class: 'ar-content' }, [
    node('p', { class: 'ar-intro' }, content.intro || event.description || ''), facts,
  ]);
  if (content.highlights?.length) story.append(node('ul', { class: 'ar-highlights' }, content.highlights.map(item => node('li', {}, item))));
  for (const block of content.blocks || []) {
    if (block.type === 'text') story.append(node('div', { class: 'ar-block' }, node('p', {}, block.text)));
    if (block.type === 'image' && safeImage(block.src)) story.append(node('div', { class: 'ar-block' }, node('img', { src: safeImage(block.src), alt: block.alt || '', loading: 'lazy', referrerpolicy: 'no-referrer' })));
  }
  if (managed?.registrations?.length) {
    const history = node('section', { class:'ar-registration-history' }, [
      node('h2', {}, t('ar_my_activities')),
      ...managed.registrations.map(item => node('a', { class:'ar-registration-history-item',
        href:`/crm/activity-registration.html?slug=${encodeURIComponent(item.slug)}#manage=${encodeURIComponent(managed.managementToken)}` }, [
        node('strong', {}, item.content?.title || item.activityName),
        node('span', {}, `${t('ar_activity')} · ${item.activity?.activity_date || t('ar_to_be_announced')}`),
        node('span', { class:'ar-status' }, t(statusKeys[item.status] || 'ar_status_pending')),
      ])),
    ]);
    story.append(history);
  }
  const layout = node('div', { class: 'ar-layout' }, [story, managed ? renderManageForm(managed) : renderRegistrationForm(page, credentialToken)]);
  const shell = node('div', { class: 'ar-shell' }, [renderTop(), hero, layout]);
  shell.append(node('footer', { class: 'ar-footer' }, t('ar_privacy')));
  root.replaceChildren(shell);
}

function renderRegistrationForm(page, token = '') {
  const { fields, controls } = formFields(page.formSchema);
  const attendee = createInput('text', '', t('ar_name_placeholder')); attendee.name = 'attendeeName'; attendee.required = true; attendee.maxLength = 120;
  const phone = createInput('tel', '', t('ar_phone_placeholder')); phone.name = 'phone'; phone.maxLength = 40;
  const wechat = createInput('text', '', t('ar_wechat_placeholder')); wechat.name = 'wechat'; wechat.maxLength = 100;
  const existingLink = createInput('text', '', t('ar_existing_link_placeholder')); existingLink.name = 'existingManagementLink'; existingLink.maxLength = 2000;
  const error = node('p', { class: 'ar-error', hidden: '' });
  const form = node('form', { onsubmit: async e => {
    e.preventDefault(); error.hidden = true;
    if (!phone.value.trim() && !wechat.value.trim()) { error.textContent = t('ar_contact_required'); error.hidden = false; return; }
    const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = t('ar_submitting');
    try {
      const answers = Object.fromEntries([...controls].map(([key, control]) => [key, control.value]));
      const supplied = token || extractManagementToken(existingLink.value);
      const result = await api('submit', { slug: page.slug, attendeeName: attendee.value, phone: phone.value, wechat: wechat.value, answers,
        ...(supplied ? { managementToken:supplied } : {}) });
      const url = new URL(location.href); url.hash = `manage=${encodeURIComponent(result.managementToken)}`;
      history.replaceState(null, '', url.href);
      credentialToken = result.managementToken;
      const mine = await api('getMyRegistration', { managementToken:result.managementToken });
      managed = { managementToken:result.managementToken, registrations:mine.registrations,
        registration:mine.registrations.find(item=>item.id===result.submissionId) };
      render();
    } catch (err) { error.textContent = translateError(err); error.hidden = false; submit.disabled = false; submit.textContent = t('ar_submit'); }
  } }, [node('h2', {}, t('ar_form_title')), node('p', { class: 'ar-note' }, t('ar_form_note')),
    field(t('ar_name'), attendee, true), field(t('ar_phone'), phone), field(t('ar_wechat'), wechat),
    token ? node('p', { class:'ar-note' }, t('ar_existing_link_active')) : field(t('ar_existing_link'), existingLink), ...fields,
    error, node('button', { class: 'ar-submit', type: 'submit' }, t('ar_submit'))]);
  return node('section', { class: 'ar-form' }, form);
}

function renderManageForm(data) {
  const registration = data.registration || {};
  const { fields, controls } = formFields(currentPage?.formSchema, registration.answers || {});
  const attendee = createInput('text', registration.attendeeName || '', t('ar_name_placeholder')); attendee.name='attendeeName'; attendee.required = true; attendee.maxLength = 120;
  const phone = createInput('tel', registration.phone || '', t('ar_phone_placeholder')); phone.name='phone'; phone.maxLength = 40;
  const wechat = createInput('text', registration.wechat || '', t('ar_wechat_placeholder')); wechat.name='wechat'; wechat.maxLength = 100;
  const status = node('span', { class: 'ar-status' }, t(statusKeys[registration.status] || 'ar_status_pending'));
  const error = node('p', { class: 'ar-error', hidden: '' });
  const privateLink = node('div', { class:'ar-success' }, [
    node('p', {}, t('ar_manage_link_notice')),
    node('button', { type:'button', class:'ar-lang', onclick:async event=>{
      try { await navigator.clipboard.writeText(location.href); event.currentTarget.textContent=t('ar_link_copied'); }
      catch { window.prompt(t('ar_copy_prompt'),location.href); }
    } }, t('ar_copy_link')),
  ]);
  const canEdit = ['pending','waitlisted'].includes(registration.status);
  const form = node('form', { onsubmit: async e => {
    e.preventDefault(); error.hidden = true;
    if (!phone.value.trim() && !wechat.value.trim()) { error.textContent = t('ar_contact_required'); error.hidden = false; return; }
    const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
    try {
      const answers = Object.fromEntries([...controls].map(([key, control]) => [key, control.value]));
      const result = await api('updateMyRegistration', { managementToken: data.managementToken, submissionId:registration.id,
        attendeeName: attendee.value, phone: phone.value, wechat: wechat.value, answers });
      managed.registration = { ...registration, attendeeName: attendee.value, phone: phone.value, wechat: wechat.value, answers, status: result.status };
      managed.registrations = managed.registrations.map(item=>item.id===registration.id?managed.registration:item);
      render();
    } catch (err) { error.textContent = translateError(err); error.hidden = false; submit.disabled = false; }
  } }, [node('h2', {}, t('ar_manage_title')), status,
    node('p', { class: 'ar-note' }, t('ar_manage_note')), privateLink,
    field(t('ar_name'), attendee, true), field(t('ar_phone'), phone), field(t('ar_wechat'), wechat), ...fields,
    error, canEdit ? node('button', { class: 'ar-submit', type: 'submit' }, t('ar_save')) : null,
    node('p', { class: 'ar-note' }, `${t('ar_activity')}：${registration.activityName || ''}`)]);
  return node('section', { class: 'ar-form' }, form);
}

function translateError(error) {
  const codes = { CONTACT_REQUIRED: 'ar_contact_required', FORM_REQUIRED: 'ar_form_required', FORM_INVALID: 'ar_form_invalid',
    REGISTRATION_FULL: 'ar_full', REGISTRATION_LOCKED: 'ar_locked', PAGE_UNAVAILABLE: 'ar_unavailable',
    INVALID_MANAGEMENT_LINK: 'ar_bad_link', REGISTRATION_NOT_FOUND: 'ar_bad_link', ALREADY_REGISTERED:'ar_already_registered' };
  return t(codes[error?.message] || 'ar_submit_error');
}

function extractManagementToken(value) {
  const raw=String(value||'').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URLSearchParams(new URL(raw).hash.slice(1)).get('manage') || '';
  } catch {}
  return raw;
}

async function load() {
  if (!config.envId) return showUnavailable(t('ar_service_unavailable'));
  const params = new URLSearchParams(location.search);
  const token = new URLSearchParams(location.hash.slice(1)).get('manage');
  if (token) {
    try {
      const result = await api('getMyRegistration', { managementToken: token });
      credentialToken=token;
      const slug=params.get('slug');
      let selected=result.registrations.find(item=>item.slug===slug);
      if (!selected && slug) currentPage=(await api('getPublishedPage',{slug})).page;
      if (selected) {
        currentPage={slug:selected.slug,content:selected.content,formSchema:selected.formSchema,activity:selected.activity};
        managed={managementToken:token,registrations:result.registrations,registration:selected};
        renderEvent(currentPage);
      } else if (currentPage) renderEvent(currentPage);
      else {
        selected=result.registrations[0];
        currentPage={slug:selected.slug,content:selected.content,formSchema:selected.formSchema,activity:selected.activity};
        managed={managementToken:token,registrations:result.registrations,registration:selected};
        renderEvent(currentPage);
      }
    } catch (err) { showUnavailable(translateError(err)); }
    return;
  }
  const slug = params.get('slug');
  if (!slug) return showUnavailable(t('ar_missing_slug'));
  try { const result = await api('getPublishedPage', { slug }); currentPage = result.page; renderEvent(currentPage); }
  catch (err) { showUnavailable(translateError(err)); }
}

function render() { if (managed) renderEvent(currentPage); else if (currentPage) renderEvent(currentPage); }
load();
