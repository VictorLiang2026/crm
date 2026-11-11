'use strict';

const crypto = require('node:crypto');
const {recipient,seal}=require('./registration-reply');
const cloudbase = require('@cloudbase/node-sdk');
const ENV = process.env.TCB_ENV;
const app = cloudbase.init({ env: ENV });
const TABLES = new Set([
  'activities', 'persons', 'activity_registration_pages', 'activity_registration_submissions',
  'activity_registration_people', 'activity_registration_audit',
]);
const STATUSES = new Set(['pending', 'approved', 'rejected', 'waitlisted', 'withdrawn']);
const PUBLIC_ACTIONS = new Set(['getPublishedPage', 'submit', 'getMyRegistration', 'updateMyRegistration']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const text = (value, max = 3000) => typeof value === 'string' && value.length <= max ? value.trim() : '';
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

async function request(table, method, params = {}, body) {
  const writeRpc=table==='rpc/crm_activity_registration_write_v1' && method==='POST';
  if (!writeRpc && !TABLES.has(table)) fail('INVALID_RESOURCE');
  const env = ENV, key = process.env.CRM_ACTIVITY_REGISTRATION_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || typeof key !== 'string' || key.length < 20) fail('SERVICE_UNAVAILABLE');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', 'Content-Profile': 'public',
      Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = typeof payload.code === 'string' && /^[A-Z0-9]{5}$/.test(payload.code) ? payload.code : '';
    if(writeRpc && payload.code==='P0001' && ['REGISTRATION_NOT_FOUND','REGISTRATION_LOCKED','REGISTRATION_FULL','ALREADY_REGISTERED','APPROVAL_REQUIRED','FORM_INVALID','PERSON_NOT_FOUND','PERSON_ALREADY_LINKED_TO_EVENT','PAGE_UNAVAILABLE'].includes(payload.message))fail(payload.message);
    console.warn('ACTIVITY_REGISTRATION_DB_ERROR', { status: response.status, code });
    fail('DATABASE_REQUEST_FAILED');
  }
  const raw = await response.text();
  if (!raw) return [];
  const result = JSON.parse(raw);
  if (writeRpc && plain(result)) return result;
  if (!Array.isArray(result)) fail('DATABASE_RESPONSE_INVALID');
  return result;
}

function caller() {
  const info = app.auth().getUserInfo();
  // getUserInfo exposes uid but no anonymous flag. The admin function is therefore
  // never anonymous-allowlisted; OPA blocks anon/unauthenticated calls before here.
  if (!info || typeof info.uid !== 'string' || !info.uid.trim())
    fail('UNAUTHORIZED');
  return info.uid;
}

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

async function pageBySlug(value, publishedOnly = false) {
  const rows = await request('activity_registration_pages', 'GET', {
    select: 'id,activity_id,slug,status,content,form_schema,capacity,published_at', slug: `eq.${slug(value)}`, limit: '1',
  });
  const page = rows[0];
  if (!page || (publishedOnly && page.status !== 'published')) fail('PAGE_UNAVAILABLE');
  const events = await request('activities', 'GET', {
    select: 'id,name,activity_date,activity_type,location,description', id: `eq.${page.activity_id}`, deleted_at: 'is.null', limit: '1',
  });
  if (!events[0]) fail('PAGE_UNAVAILABLE');
  return { ...page, activity: events[0] };
}

async function writeRegistration(operation, data) {
  return request('rpc/crm_activity_registration_write_v1','POST',{}, {p_operation:operation,p_data:data});
}

async function adminListPages() {
  caller();
  const pages = await request('activity_registration_pages', 'GET', {
    select: 'id,activity_id,slug,status,content,form_schema,capacity,published_at,updated_at', order: 'updated_at.desc', limit: '200',
  });
  return { rows: pages };
}

async function savePage(event, uid) {
  const data = event?.data;
  if (!plain(data) || !/^[1-9]\d*$/.test(String(data.activityId))) fail('INVALID_ACTIVITY');
  const activityId = String(data.activityId);
  const activities = await request('activities', 'GET', { select: 'id', id: `eq.${activityId}`, deleted_at: 'is.null', limit: '1' });
  if (!activities.length) fail('ACTIVITY_NOT_FOUND');
  const row = {
    activity_id: Number(activityId), slug: slug(data.slug), status: ['draft','published','closed'].includes(data.status) ? data.status : 'draft',
    content: validateContent(data.content), form_schema: validateFields(data.formSchema),
    published_at: data.status === 'published' ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  };
  let result;
  if (data.id) {
    const id = text(data.id, 50);
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID_PAGE');
    result = await request('activity_registration_pages', 'PATCH', { id: `eq.${id}`, activity_id: `eq.${activityId}` }, row);
    if (!result.length) fail('PAGE_NOT_FOUND');
  } else {
    result = await request('activity_registration_pages', 'POST', {}, row);
  }
  return { page: result[0], publicUrl: `${process.env.CRM_ACTIVITY_REGISTRATION_PUBLIC_ORIGIN || 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com'}/crm/activity-registration.html?slug=${encodeURIComponent(row.slug)}` };
}

async function adminListSubmissions(event) {
  caller();
  const pageId = text(event.pageId, 50);
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) fail('INVALID_PAGE');
  const page = Math.max(1, Math.min(10000, Number(event.page || 1)));
  const size = Math.max(1, Math.min(50, Number(event.pageSize || 20)));
  const status = text(event.status, 20);
  const filters = { select: 'id,page_id,attendee_name,phone,wechat,answers,status,notification_status,reviewed_by,reviewed_at,created_at,updated_at',
    page_id: `eq.${pageId}`, order: 'created_at.desc,id.desc', limit: String(size + 1), offset: String((page - 1) * size) };
  if (STATUSES.has(status)) filters.status = `eq.${status}`;
  const rows = await request('activity_registration_submissions', 'GET', filters);
  return { rows: rows.slice(0, size), hasMore: rows.length > size, page, pageSize: size };
}

async function review(event, uid) {
  const id = text(event.id, 50), status = event.status;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['approved','rejected','waitlisted'].includes(status)) fail('INVALID_REVIEW');
  return writeRegistration('review',{id,status,actor:uid});
}

async function markNotified(event,uid) {
  const id=text(event.id,50);
  if(!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_REGISTRATION');
  return writeRegistration('notify',{id,actor:uid});
}

async function reissueManagementLink(event,uid) {
  const id=text(event.id,50);
  if(!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_REGISTRATION');
  const token=randomToken();
  const {slug}=await writeRegistration('rotate',{id,newHash:tokenHash(token),actor:uid});
  const origin=process.env.CRM_ACTIVITY_REGISTRATION_PUBLIC_ORIGIN||'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com';
  return {url:origin+'/crm/activity-registration.html?slug='+encodeURIComponent(slug)+'#manage='+encodeURIComponent(token)};
}

async function linkPerson(event,uid) {
  const id=text(event.submissionId,50),personId=String(event.personId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[1-9]\d*$/.test(personId))fail('INVALID_REGISTRATION');
  return writeRegistration('link',{id,personId,actor:uid});
}

async function searchPersons(event) {
  caller();
  const keyword = text(event.keyword, 80);
  if (keyword.length < 1) return { rows: [] };
  const encoded = keyword.replace(/[,%()]/g, ' ').trim();
  const rows = await request('persons', 'GET', { select: 'id,display_name', deleted_at: 'is.null', display_name: `ilike.*${encoded}*`, order: 'display_name.asc', limit: '15' });
  return { rows };
}

async function personActivities(event) {
  caller();
  const personId = String(event.personId || '');
  if (!/^[1-9]\d*$/.test(personId)) fail('INVALID_PERSON');
  const links = await request('activity_registration_people', 'GET', { select: 'activity_id,submission_id,linked_at', person_id: `eq.${personId}`, order: 'linked_at.desc', limit: '100' });
  if (!links.length) return { rows:[] };
  const ids = values => `in.(${values.map(value => String(value).replace(/[^0-9a-f-]/gi,'')).join(',')})`;
  const submissions = await request('activity_registration_submissions', 'GET', {
    select:'id,page_id,status,created_at', id:ids(links.map(link=>link.submission_id)), limit:'100',
  });
  const pages = submissions.length ? await request('activity_registration_pages', 'GET', {
    select:'id,content', id:ids(submissions.map(row=>row.page_id)), limit:'100',
  }) : [];
  const activityIds = [...new Set(links.map(link=>String(link.activity_id)))];
  const activities = await request('activities', 'GET', {
    select:'id,name,activity_date,location', id:`in.(${activityIds.map(value=>value.replace(/\D/g,'')).join(',')})`, limit:'100',
  });
  const bySubmission = new Map(submissions.map(row=>[row.id,row]));
  const byPage = new Map(pages.map(row=>[row.id,row]));
  const byActivity = new Map(activities.map(row=>[String(row.id),row]));
  return { rows:links.flatMap(link=>{
    const submission=bySubmission.get(link.submission_id), page=submission&&byPage.get(submission.page_id), activity=byActivity.get(String(link.activity_id));
    return submission&&page&&activity?[{...submission,activity,title:page.content?.title||activity.name}]:[];
  }) };
}

async function activityPeople(event) {
  caller();
  const activityId = String(event.activityId || '');
  if (!/^[1-9]\d*$/.test(activityId)) fail('INVALID_ACTIVITY');
  const links = await request('activity_registration_people', 'GET', {
    select:'submission_id,person_id,linked_at', activity_id:`eq.${activityId}`, order:'linked_at.desc', limit:'100',
  });
  if (!links.length) return { rows:[] };
  const personIds = [...new Set(links.map(link=>String(link.person_id)))];
  const persons = await request('persons', 'GET', {
    select:'id,display_name', id:`in.(${personIds.map(id=>id.replace(/\D/g,'')).join(',')})`, deleted_at:'is.null', limit:'100',
  });
  const submissionIds = [...new Set(links.map(link=>link.submission_id))];
  const submissions = await request('activity_registration_submissions', 'GET', {
    select:'id,attendee_name,status', id:`in.(${submissionIds.map(id=>id.replace(/[^0-9a-f-]/gi,'')).join(',')})`, limit:'100',
  });
  const personMap = new Map(persons.map(person=>[String(person.id),person]));
  const submissionMap = new Map(submissions.map(item=>[item.id,item]));
  return { rows:links.flatMap(link=>{
    const person=personMap.get(String(link.person_id)), submission=submissionMap.get(link.submission_id);
    return person&&submission?[{personId:String(person.id),personName:person.display_name,
      attendeeName:submission.attendee_name,status:submission.status,linkedAt:link.linked_at}]:[];
  }) };
}

async function publicPage(event) {
  const page = await pageBySlug(event.slug, true);
  return { page: { slug: page.slug, content: page.content, formSchema: page.form_schema,
    activity: page.activity, capacity: page.capacity } };
}

async function submit(event) {
  const page = await pageBySlug(event.slug, true);
  const name = text(event.attendeeName, 120), phone = text(event.phone, 40), wechat = text(event.wechat, 100);
  if (!name || (!phone && !wechat)) fail('CONTACT_REQUIRED');
  let token = randomToken();
  const suppliedToken = text(event.managementToken, 128);
  if (suppliedToken) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(suppliedToken)) fail('INVALID_MANAGEMENT_LINK');
    token = suppliedToken;
  }
  const answersIn = plain(event.answers) ? event.answers : {};
  const fields = validateFields(page.form_schema);
  const answers = {};
  for (const field of fields) {
    const value = text(answersIn[field.key], 1000);
    if (field.required && !value) fail('FORM_REQUIRED');
    if (field.type === 'select' && value && !field.options.includes(value)) fail('FORM_INVALID');
    if (value) answers[field.key] = value;
  }
  if (Object.keys(answersIn).some(key => !fields.some(field => field.key === key))) fail('FORM_INVALID');
  const {submissionId}=await writeRegistration('submit',{pageId:page.id,schema:page.form_schema,
    name,phone,wechat,answers,hash:tokenHash(token),reuse:Boolean(suppliedToken)});
  return {ok:true,status:'pending',managementToken:token,submissionId,activityName:page.activity.name};
}

async function ownerRegistration(event, update = false) {
  const token = text(event.managementToken, 128);
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) fail('INVALID_MANAGEMENT_LINK');
  const hash = tokenHash(token);
  if (!update) {
    const submissions = await request('activity_registration_submissions', 'GET', {
      select:'id,page_id,attendee_name,phone,wechat,answers,status,notification_status,created_at,updated_at',
      management_token_hash:`eq.${hash}`, status:'not.eq.withdrawn', order:'created_at.desc,id.desc', limit:'50',
    });
    if (!submissions.length) fail('REGISTRATION_NOT_FOUND');
    const pageIds = [...new Set(submissions.map(row=>row.page_id))];
    const pages = await request('activity_registration_pages', 'GET', {
      select:'id,activity_id,slug,content,form_schema', id:`in.(${pageIds.join(',')})`, limit:'50',
    });
    const activityIds = [...new Set(pages.map(row=>String(row.activity_id)))];
    const activities = activityIds.length ? await request('activities', 'GET', {
      select:'id,name,activity_date,location', id:`in.(${activityIds.join(',')})`, limit:'50',
    }) : [];
    const byPage = new Map(pages.map(row=>[row.id,row]));
    const byActivity = new Map(activities.map(row=>[String(row.id),row]));
    const registrations = submissions.flatMap(submission=>{
      const page=byPage.get(submission.page_id), activity=page&&byActivity.get(String(page.activity_id));
      return page&&activity?[{id:submission.id,slug:page.slug,attendeeName:submission.attendee_name,phone:submission.phone,
        wechat:submission.wechat,answers:submission.answers,status:submission.status,notificationStatus:submission.notification_status,
        updatedAt:submission.updated_at,activityName:activity.name,activity,content:page.content,formSchema:page.form_schema}]:[];
    });
    if (!registrations.length) fail('REGISTRATION_NOT_FOUND');
    return { registrations };
  }
  const submissionId = text(event.submissionId, 50);
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) fail('INVALID_REGISTRATION');
  const submission = (await request('activity_registration_submissions', 'GET', {
    select:'id,page_id,attendee_name,phone,wechat,answers,status', id:`eq.${submissionId}`,
    management_token_hash:`eq.${hash}`, status:'not.eq.withdrawn', limit:'1',
  }))[0];
  if (!submission) fail('REGISTRATION_NOT_FOUND');
  const page = (await request('activity_registration_pages', 'GET', {
    select:'form_schema', id:`eq.${submission.page_id}`, limit:'1',
  }))[0];
  if (!page) fail('REGISTRATION_NOT_FOUND');
  if (!['pending','waitlisted'].includes(submission.status)) fail('REGISTRATION_LOCKED');
  const name = text(event.attendeeName, 120), phone = text(event.phone, 40), wechat = text(event.wechat, 100);
  if (!name || (!phone && !wechat)) fail('CONTACT_REQUIRED');
  const fields = validateFields(page.form_schema), input = plain(event.answers) ? event.answers : {}, answers = {};
  for (const field of fields) {
    const value = text(input[field.key], 1000);
    if (field.required && !value) fail('FORM_REQUIRED');
    if (field.type === 'select' && value && !field.options.includes(value)) fail('FORM_INVALID');
    if (value) answers[field.key] = value;
  }
  if (Object.keys(input).some(key => !fields.some(field => field.key === key))) fail('FORM_INVALID');
  return writeRegistration('edit',{id:submission.id,hash,schema:page.form_schema,name,phone,wechat,answers});
}

let transport;
function configuredTransport() {
  if (!transport) transport = require('./registration-request').requestTransport(process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM);
  return transport;
}
async function dispatch(event, publicOnly) {
  try {
    const action = text(event?.action, 40);
    if (action === 'getRegistrationTransportKey') return {publicKey:configuredTransport().publicKey};
    if (publicOnly ? !PUBLIC_ACTIONS.has(action) : PUBLIC_ACTIONS.has(action)) fail('UNKNOWN_ACTION');
    if (action !== 'getPublishedPage') event = configuredTransport().open(action,event.sealedRequest);
    if (!PUBLIC_ACTIONS.has(action)) caller();
    const key = action==='getPublishedPage' ? null : recipient(event.replyKey);
    const value=await perform(action,event);
    return key ? seal(value,key) : value;
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,60}$/.test(String(error?.code || error?.message || ''))
      ? String(error.code || error.message) : 'REQUEST_FAILED';
    return { error: code };
  }
}

async function perform(action,event) {
  switch (action) {
    case 'getPublishedPage': return await publicPage(event);
    case 'submit': return await submit(event);
    case 'getMyRegistration': return await ownerRegistration(event);
    case 'updateMyRegistration': return await ownerRegistration(event, true);
    case 'listPages': return await adminListPages();
    case 'savePage': return await savePage(event, caller());
    case 'listSubmissions': return await adminListSubmissions(event);
    case 'review': return await review(event, caller());
    case 'markNotified': return await markNotified(event, caller());
    case 'reissueManagementLink': return await reissueManagementLink(event, caller());
    case 'linkPerson': return await linkPerson(event, caller());
    case 'searchPersons': return await searchPersons(event);
    case 'personActivities': return await personActivities(event);
    case 'activityPeople': return await activityPeople(event);
    default: fail('UNKNOWN_ACTION');
  }
}

exports.main = event => dispatch(event, false);
exports.publicMain = event => dispatch(event, true);
