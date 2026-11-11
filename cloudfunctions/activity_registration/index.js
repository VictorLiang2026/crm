'use strict';
const crypto = require('node:crypto');
const {recipient,seal} = require('./registration-reply');
const {signedCall} = require('./registration-signed');
const PUBLIC_ACTIONS = new Set(['getPublishedPage', 'submit', 'getMyRegistration', 'updateMyRegistration']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const text = (value, max = 3000) => typeof value === 'string' && value.length <= max ? value.trim() : '';

const STAFF_ACTIONS=new Set(['listPages','savePage','listSubmissions','review','markNotified','reissueManagementLink','linkPerson','searchPersons','personActivities','activityPeople']);
function slug(value) {
  const v = text(value, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(v)) fail('INVALID_SLUG');
  return v;
}

function validateContent(content) {
  if (!plain(content) || Object.keys(content).some(k => !['title','intro','coverUrl','blocks','highlights'].includes(k))) fail('INVALID_CONTENT');
  const title = text(content.title, 160), intro = text(content.intro, 1200);
  const coverUrl = text(content.coverUrl, 1000);
  if (!title) fail('TITLE_REQUIRED');
  if (coverUrl && (!/^https:\/\//i.test(coverUrl) || !URL.canParse(coverUrl))) fail('INVALID_IMAGE_URL');
  const blocks = Array.isArray(content.blocks) ? content.blocks.slice(0, 30).map(block => {
    if (!plain(block) || !['text','image'].includes(block.type)) fail('INVALID_CONTENT_BLOCK');
    if (block.type === 'text') {
      const value = text(block.text, 3000);
      if (!value) fail('INVALID_CONTENT_BLOCK');
      return { type: 'text', text: value };
    }
    const src = text(block.src, 1000), alt = text(block.alt, 160);
    if (!/^https:\/\//i.test(src) || !URL.canParse(src)) fail('INVALID_IMAGE_URL');
    return { type: 'image', src, alt };
  }) : [];
  const highlights = Array.isArray(content.highlights) ? content.highlights.slice(0, 8).map(v => text(v, 120)).filter(Boolean) : [];
  return { title, intro, coverUrl, blocks, highlights };
}

function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length > 12) fail('INVALID_FORM');
  const used = new Set();
  return fields.map(field => {
    if (!plain(field) || Object.keys(field).some(k => !['key','label','type','required','options'].includes(k))) fail('INVALID_FORM_FIELD');
    const key = text(field.key, 40), label = text(field.label, 80), type = field.type;
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || used.has(key) || !label || !['text','textarea','select'].includes(type)) fail('INVALID_FORM_FIELD');
    used.add(key);
    const options = type === 'select' && Array.isArray(field.options) ? field.options.slice(0, 20).map(v => text(v, 80)).filter(Boolean) : [];
    if (type === 'select' && options.length < 2) fail('INVALID_FORM_FIELD');
    return { key, label, type, required: field.required === true, ...(type === 'select' ? { options } : {}) };
  });
}


let transport;
function configuredTransport(){
  if (!transport) transport=require('./registration-request').requestTransport(process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM);
  return transport;
}
function prepare(action,event) {
  if (action==='getPublishedPage') return {slug:slug(event.slug)};
  const {replyKey,requestId,issued,action:ignored,...data}=event;
  // Actor and signing scope are populated separately from verified server context.
  delete data.actor; delete data.fingerprint;
  if (action==='submit'||action==='updateMyRegistration') {
    data.attendeeName=text(data.attendeeName,120); data.phone=text(data.phone,40);data.wechat=text(data.wechat,100);
    if (!data.attendeeName||(!data.phone&&!data.wechat)) fail('CONTACT_REQUIRED');
    if(data.phone&&data.phone.length<5) fail('CONTACT_REQUIRED');
    if (!plain(data.answers||{})) fail('FORM_INVALID');
  }
  if(action==='submit')data.slug=slug(data.slug);
  if (['submit','updateMyRegistration','getMyRegistration'].includes(action)) {
    const token=data.managementToken;
    if (token || action!=='submit') {
      if (typeof token!=='string'||!/^[A-Za-z0-9_-]{40,64}$/.test(token)) fail('INVALID_MANAGEMENT_LINK');
      data.ownerHash=crypto.createHash('sha256').update(token).digest('hex');
    } else delete data.ownerHash;
    delete data.managementToken;
  }
  if(action==='savePage') {
    const page=data.data;
    if(!plain(page)||!/^\d{1,16}$/.test(String(page.activityId)) || !['published','closed','draft'].includes(page.status))fail('INVALID_PAGE');
    return {id:page.id||null,activityId:String(page.activityId),slug:slug(page.slug),status:page.status,content:validateContent(page.content),formSchema:validateFields(page.formSchema)};
  }
  return data;
}
async function dispatch(event, publicOnly) {
  try {
    const action = text(event?.action, 40);
    const scope=publicOnly?'public':'staff';
    if(process.env.CRM_REGISTRATION_SCOPE!==scope)fail('UNAUTHORIZED');
    if (action==='getRegistrationTransportKey') return {publicKey:configuredTransport().publicKey};
    if (publicOnly ? !PUBLIC_ACTIONS.has(action) : !STAFF_ACTIONS.has(action)) fail('UNKNOWN_ACTION');
    const privateRequest=action!=='getPublishedPage';
    if(privateRequest)event=configuredTransport().open(action,event.sealedRequest);
    const target=privateRequest?recipient(event.replyKey):null;
    const staff=publicOnly?{}:require('./device-runtime').registrationStaff();
    const result=await signedCall(scope,{action,data:prepare(action,event),...staff,requestId:event.requestId||crypto.randomUUID(),
      client:target?crypto.createHash('sha256').update(event.replyKey).digest('hex'):null});
    if(action==='submit'&&event.managementToken)result.managementToken=event.managementToken;
    if(action==='savePage'||action==='reissueManagementLink'){
      const origin=process.env.CRM_ACTIVITY_REGISTRATION_PUBLIC_ORIGIN||'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com';
      const link=origin+'/crm/activity-registration.html?slug='+encodeURIComponent(result.slug);
      if(action==='savePage'){result.publicUrl=link;}else{result.url=link+'#manage='+encodeURIComponent(result.managementToken);delete result.managementToken;}
      delete result.slug;
    }
    return target?seal(result,target):result;
  }catch(error){
    const code=/^[A-Z][A-Z0-9_]{1,60}$/.test(String(error?.code||error?.message||''))?String(error.code||error.message):'REQUEST_FAILED';
    return {error:code};
  }
}
exports.main = event => dispatch(event, false);
exports.publicMain = event => {
  if (event && Object.hasOwn(event,'body')) {
    if (event.httpMethod && event.httpMethod !== 'POST') return {error:'INVALID_REQUEST'};
    try {
      const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body;
      if(typeof raw==='string' && Buffer.byteLength(raw)>175000) return {error:'INVALID_REQUEST'};
      event=typeof raw==='string'?JSON.parse(raw):raw;
    } catch { return {error:'INVALID_REQUEST'}; }
  }
  return dispatch(event,true);
};
exports.main = require('./device-runtime').protect('activity_registration', exports.main);
