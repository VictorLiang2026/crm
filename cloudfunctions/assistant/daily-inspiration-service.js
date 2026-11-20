/** Daily insurance-industry encouragement selected from a human-maintained library. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

const THEMES = new Set(['team_leadership','business_development','customer_service','customer_trust',
  'protection','long_term','team_growth']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function fail(code) { const error = new Error(code); error.code = code; throw error; }

function mapQuote(row) {
  if (!row) return null;
  return { id:String(row.id), quoteZh:row.quote_zh, quoteEn:row.quote_en, theme:row.theme,
    sourceOrg:row.source_org, sourceTitle:row.source_title, sourceUrl:row.source_url,
    editorialRewrite:row.editorial_rewrite, enabled:row.enabled, updatedAt:row.updated_at };
}

function database() {
  return createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY }).auditRdb;
}

function localClock(timeZone, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now);
  } catch (_) { fail('INVALID_TIMEZONE'); }
  const value = Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type,item.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, minute: Number(value.hour)*60+Number(value.minute) };
}

function minutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('INVALID_SETTINGS');
  const [hour, minute] = value.split(':').map(Number);
  return hour*60+minute;
}

function segmentFor(localMinute, settings) {
  const first = minutes(settings.firstPeriodStart);
  const second = minutes(settings.secondPeriodStart);
  if (first >= second) fail('INVALID_SETTINGS');
  return localMinute >= first && localMinute < second ? 'first' : 'second';
}

function avoidPool(candidates, currentQuoteId, now = Date.now()) {
  const candidate = candidates.filter(row => String(row.id) !== String(currentQuoteId));
  const fresh = candidate.filter(row => {
    const shown = row.lastShownAt ? Date.parse(row.lastShownAt) : 0;
    const replaced = row.lastReplacedAt ? Date.parse(row.lastReplacedAt) : 0;
    return (!shown || now - shown >= 30*86400000) && (!replaced || now - replaced >= 60*86400000);
  });
  if (fresh.length >= Math.min(3, candidate.length)) return fresh;
  const relaxed = candidate.filter(row => {
    const shown = row.lastShownAt ? Date.parse(row.lastShownAt) : 0;
    const replaced = row.lastReplacedAt ? Date.parse(row.lastReplacedAt) : 0;
    return (!shown || now - shown >= 14*86400000) && (!replaced || now - replaced >= 60*86400000);
  });
  return relaxed.length ? relaxed : (candidate.length ? candidate : candidates);
}

function deterministicChoice(rows, date, segment, actorUid = '') {
  if (!rows.length) return null;
  const seed = `${actorUid}:${date}:${segment}`;
  let hash = 2166136261;
  for (let index=0; index<seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return rows[(hash >>> 0) % rows.length];
}

async function invokeSelection({ date, segment, candidates, currentQuoteId, actorUid = '' }) {
  if (!candidates.length) return null;
  if (currentQuoteId && !candidates.some(row => String(row.id) !== String(currentQuoteId))) return null;
  const pool = avoidPool(candidates, currentQuoteId);
  if (!pool.length) return null;
  try {
    const gateway = createAIGateway({ app:require('./db').app, rdb: database(), timeoutMs: 25000, maxAttempts: 1 });
    const task = await gateway.runAITask({
      taskType: 'daily_inspiration', skill: 'daily_inspiration', capability: 'coaching',
      input: { date, segment, selection_instruction:'Choose one supplied candidate that fits this work period and offers practical encouragement. Return its ID only; do not rewrite the quote or invent insurance, legal, product, return, or coverage claims.',
        candidate_ids: pool.map(row => Number(row.id)) },
      context: { candidate_quotes: pool.map(row => ({ id:Number(row.id), quote_zh:row.quoteZh,
        quote_en:row.quoteEn, theme:row.theme, source_org:row.sourceOrg, source_title:row.sourceTitle })) },
    });
    return pool.find(row => Number(row.id) === task.result.quote_id) || deterministicChoice(pool,date,segment,actorUid);
  } catch (error) {
    console.error('DAILY_INSPIRATION_AI_FALLBACK', String(error?.code || 'AI_FAILED'));
    return deterministicChoice(pool,date,segment,actorUid);
  }
}

async function rpc(db, operation, actorUid, data = {}) {
  const response = await db.rpc('crm_daily_inspiration_v1', {
    p_operation: operation, p_actor_uid: actorUid, p_data: data,
  });
  if (response?.error || !record(response?.data)) fail('DAILY_INSPIRATION_PERSISTENCE_ERROR');
  return response.data;
}

function validateQuote(data) {
  const allowed = ['id','quoteZh','quoteEn','theme','sourceOrg','sourceTitle','sourceUrl','editorialRewrite'];
  if (!record(data) || Object.keys(data).some(key => !allowed.includes(key)) ||
      (data.id !== undefined && !/^[1-9][0-9]{0,17}$/.test(String(data.id))) ||
      typeof data.quoteZh !== 'string' || data.quoteZh.trim().length < 4 || data.quoteZh.length > 300 ||
      typeof data.quoteEn !== 'string' || data.quoteEn.trim().length < 4 || data.quoteEn.length > 500 ||
      !THEMES.has(data.theme) || typeof data.sourceOrg !== 'string' || !data.sourceOrg.trim() || data.sourceOrg.length > 120 ||
      typeof data.sourceTitle !== 'string' || !data.sourceTitle.trim() || data.sourceTitle.length > 240 ||
      typeof data.sourceUrl !== 'string' || !/^https:\/\//.test(data.sourceUrl) || data.sourceUrl.length > 1000 ||
      typeof data.editorialRewrite !== 'boolean') fail('INVALID_INPUT');
  return { ...data, ...(data.id === undefined ? {} : {id:String(data.id)}) };
}

async function currentOrChoose(db, actorUid, now = new Date()) {
  const library = await rpc(db,'library_list',actorUid);
  const settings = library.settings;
  const time = localClock(settings.timezone, now);
  const segment = segmentFor(time.minute, settings);
  const initial = await rpc(db,'current',actorUid,{localDate:time.date,segment});
  if (initial.quote) return {ok:true,quote:mapQuote(initial.quote),settings:initial.settings,localDate:time.date,segment};
  if (!initial.candidates?.length) return {ok:true,quote:null,settings:initial.settings,localDate:time.date,segment,noQuotes:true};
  const selected = await invokeSelection({date:time.date,segment,candidates:initial.candidates,
    currentQuoteId:initial.slot?.quoteId,actorUid});
  if (!selected) return {ok:true,quote:null,settings:initial.settings,localDate:time.date,segment,noQuotes:true};
  const stored = await rpc(db,'select',actorUid,{localDate:time.date,segment,quoteId:String(selected.id)});
  return {ok:true,quote:mapQuote(stored.quote),settings:stored.settings,localDate:time.date,segment};
}

async function handleDailyInspiration(event, actorUid, options = {}) {
  const db = options.db || database();
  const action = event?.operation;
  if (!['current','replace','libraryList','quoteSave','quoteToggle','settingsSave'].includes(action) ||
      Object.keys(event || {}).some(key => !['action','operation','data'].includes(key))) fail('INVALID_INPUT');
  if (action === 'libraryList') {
    if (event.data !== undefined) fail('INVALID_INPUT');
    const result=await rpc(db,'library_list',actorUid);
    return {ok:true,settings:result.settings,quotes:(result.quotes||[]).map(mapQuote)};
  }
  if (action === 'quoteSave') {
    const result=await rpc(db,'quote_save',actorUid,validateQuote(event.data));
    return {ok:true,quote:mapQuote(result.quote)};
  }
  if (action === 'quoteToggle') {
    const data=event.data;
    if (!record(data)||Object.keys(data).length!==2||!/^[1-9][0-9]{0,17}$/.test(String(data.id))||typeof data.enabled!=='boolean') fail('INVALID_INPUT');
    const result=await rpc(db,'quote_toggle',actorUid,{id:String(data.id),enabled:data.enabled});
    return {ok:true,quote:mapQuote(result.quote)};
  }
  if (action === 'settingsSave') {
    const data=event.data;
    if (!record(data)||Object.keys(data).length!==3||typeof data.timezone!=='string'||data.timezone.length>80) fail('INVALID_INPUT');
    minutes(data.firstPeriodStart); minutes(data.secondPeriodStart);
    if (minutes(data.firstPeriodStart)>=minutes(data.secondPeriodStart)) fail('INVALID_INPUT');
    return {ok:true,...await rpc(db,'settings_save',actorUid,data)};
  }
  const current=await currentOrChoose(db,actorUid,options.now || new Date());
  if (action === 'current' || !current.quote) return current;
  if (!record(event.data)||Object.keys(event.data).length!==1||String(event.data.expectedQuoteId)!==String(current.quote.id)) fail('INVALID_INPUT');
  const snapshot=await rpc(db,'current',actorUid,{localDate:current.localDate,segment:current.segment});
  const selected=await invokeSelection({date:current.localDate,segment:current.segment,
    candidates:snapshot.candidates || [],currentQuoteId:current.quote.id,actorUid});
  if (!selected) return {...current,noAlternative:true};
  try {
    const stored=await rpc(db,'replace',actorUid,{localDate:current.localDate,segment:current.segment,
      quoteId:String(selected.id),expectedQuoteId:String(current.quote.id)});
    return {ok:true,quote:mapQuote(stored.quote),settings:stored.settings,localDate:current.localDate,segment:current.segment};
  } catch (error) {
    if (error?.code==='DAILY_INSPIRATION_STALE') return currentOrChoose(db,actorUid,options.now || new Date());
    throw error;
  }
}

module.exports={handleDailyInspiration,localClock,segmentFor,avoidPool,deterministicChoice,validateQuote,mapQuote};
