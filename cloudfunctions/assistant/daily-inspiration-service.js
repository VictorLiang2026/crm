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
    editorialRewrite:row.editorial_rewrite, recommendationScore:row.recommendation_score ?? null,
    enabled:row.enabled, updatedAt:row.updated_at };
}

function database() {
  return createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY }).auditRdb;
}

function clockFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  } catch (_) { fail('INVALID_TIMEZONE'); }
}

function localClock(timeZone, now = new Date(), formatter = clockFormatter(timeZone)) {
  const parts = formatter.formatToParts(now);
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

function displaySlot(settings, now) {
  const formatter = clockFormatter(settings.timezone);
  const first = minutes(settings.firstPeriodStart);
  const second = minutes(settings.secondPeriodStart);
  if (first >= second) fail('INVALID_SETTINGS');
  const clock = localClock(settings.timezone, now, formatter);
  const segment = segmentFor(clock.minute, settings);
  const slotDate = point => point.minute < first
    ? new Date(Date.parse(point.date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
    : point.date;
  const localDate = slotDate(clock);

  // Walk real minute boundaries so the timer follows the application's IANA clock,
  // including transitions where a local hour is skipped or repeated.
  const end = now.getTime() + 48 * 60 * 60000;
  let next = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (; next < end; next += 60000) {
    const point = localClock(settings.timezone, new Date(next), formatter);
    if (settings.effectiveDate && point.date >= settings.effectiveDate) break;
    const nextSegment = point.minute >= first && point.minute < second ? 'first' : 'second';
    if (nextSegment !== segment || slotDate(point) !== localDate) break;
  }
  return {localDate, segment, nextRefreshAt:next};
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
  const unshown=candidates.filter(row=>row.rotationUsed!==true);
  const pool = avoidPool(unshown.length?unshown:candidates, currentQuoteId);
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
  if (response?.error) {
    const code=String(response.error.code||'');
    const message=String(response.error.message||'');
    const recognized=['DAILY_INSPIRATION_ROTATION_USED','DAILY_INSPIRATION_NOT_AVAILABLE','DAILY_INSPIRATION_STALE']
      .find(value => code === value || new RegExp(`\\b${value}\\b`).test(message));
    if(recognized)fail(recognized);
    fail('DAILY_INSPIRATION_PERSISTENCE_ERROR');
  }
  if(!record(response?.data))fail('DAILY_INSPIRATION_PERSISTENCE_ERROR');
  return response.data;
}

function validateQuote(data) {
  const allowed = ['id','quoteZh','quoteEn','theme','sourceOrg','sourceTitle','sourceUrl','editorialRewrite','recommendationScore'];
  const score = data?.recommendationScore === undefined ? null : data.recommendationScore;
  if (!record(data) || Object.keys(data).some(key => !allowed.includes(key)) ||
      (data.id !== undefined && !/^[1-9][0-9]{0,17}$/.test(String(data.id))) ||
      typeof data.quoteZh !== 'string' || data.quoteZh.trim().length < 4 || data.quoteZh.length > 300 ||
      typeof data.quoteEn !== 'string' || data.quoteEn.trim().length < 4 || data.quoteEn.length > 500 ||
      !THEMES.has(data.theme) || typeof data.sourceOrg !== 'string' || !data.sourceOrg.trim() || data.sourceOrg.length > 120 ||
      typeof data.sourceTitle !== 'string' || !data.sourceTitle.trim() || data.sourceTitle.length > 240 ||
      typeof data.sourceUrl !== 'string' || !/^https:\/\//.test(data.sourceUrl) || data.sourceUrl.length > 1000 ||
      typeof data.editorialRewrite !== 'boolean' ||
      (score !== null && (!Number.isInteger(score) || score < 0 || score > 10))) fail('INVALID_INPUT');
  return { ...data, recommendationScore:score, ...(data.id === undefined ? {} : {id:String(data.id)}) };
}

function autoRecommendationScore(quote) {
  const english=quote.quoteEn.toLowerCase();
  const chinese=quote.quoteZh;
  const practical=/\b(listen|ask|explain|plan|develop|recruit|serve|support|deliver|lead|build|act|learn|help|understand)\w*/.test(english) ||
    /倾听|提问|解释|规划|培养|招聘|服务|支持|兑现|领导|建设|行动|学习|帮助|理解/.test(chinese) ? 4 :
    /\b(client|customer|advisor|team|relationship|trust|insurance|retirement)\w*/.test(english) ||
    /客户|顾问|团队|关系|信任|保险|退休/.test(chinese) ? 3 : 2;
  const insight=/\b(because|rather|instead|not|without|depends|means|suggests|result|leads)\b/.test(english) ||
    /因为|而非|而不是|不是|取决于|意味着|表明|因此|带来/.test(chinese) ? 3 :
    /\b(trust|relationship|growth|purpose|value|confidence|success)\w*/.test(english) ||
    /信任|关系|成长|目标|价值|信心|成功/.test(chinese) ? 2 : 1;
  const englishWords=(english.match(/[a-z0-9]+(?:['’][a-z]+)?/g)||[]).length;
  const chineseChars=chinese.replace(/\s/g,'').length;
  const memorable=englishWords<=12 && chineseChars<=36 ? 2 : englishWords<=24 && chineseChars<=72 ? 1 : 0;
  const source=quote.sourceOrg.trim() && /^https:\/\//.test(quote.sourceUrl) ? 1 : 0;
  return Math.max(0,Math.min(10,practical+insight+memorable+source));
}

function validateScores(data) {
  if (!record(data) || Object.keys(data).length !== 1 || !Array.isArray(data.scores) ||
      data.scores.length < 1 || data.scores.length > 80) fail('INVALID_INPUT');
  const seen = new Set();
  return data.scores.map(item => {
    if (!record(item) || Object.keys(item).length !== 2 || typeof item.id !== 'string' ||
        !/^[1-9][0-9]{0,17}$/.test(item.id) || !Number.isInteger(item.recommendationScore) ||
        item.recommendationScore < 0 || item.recommendationScore > 10 || seen.has(item.id)) fail('INVALID_INPUT');
    seen.add(item.id);
    return {id:item.id,recommendationScore:item.recommendationScore};
  });
}

function normalizeQuoteText(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu,'').trim();
}

function shingles(value, width=3) {
  const text=normalizeQuoteText(value);
  if(!text)return new Set();
  const chars=Array.from(text);
  if(chars.length<=width)return new Set([text]);
  const result=new Set();
  for(let index=0;index<=chars.length-width;index++)result.add(chars.slice(index,index+width).join(''));
  return result;
}

function similarity(left,right) {
  const a=shingles(left),b=shingles(right);
  if(!a.size||!b.size)return 0;
  let shared=0;
  for(const item of a)if(b.has(item))shared++;
  return 2*shared/(a.size+b.size);
}

function nearDuplicateScore(incoming,existing) {
  return Math.max(similarity(incoming.quoteZh,existing.quoteZh),
    similarity(incoming.quoteEn,existing.quoteEn));
}

function compareBatchQuotes(quotes,existing) {
  const exact=[],near=[];
  const zh=new Map(),en=new Map();
  const seenZh=new Set(),seenEn=new Set();
  for(const row of existing){
    const keyZh=normalizeQuoteText(row.quoteZh??row.quote_zh),keyEn=normalizeQuoteText(row.quoteEn??row.quote_en);
    if(keyZh)zh.set(keyZh,row);
    if(keyEn)en.set(keyEn,row);
  }
  for(let index=0;index<quotes.length;index++){
    const quote=quotes[index], keyZh=normalizeQuoteText(quote.quoteZh), keyEn=normalizeQuoteText(quote.quoteEn);
    const match=zh.get(keyZh)||en.get(keyEn);
    if(match||seenZh.has(keyZh)||seenEn.has(keyEn)){exact.push({index,existing:match?mapQuote(match):null});continue;}
    seenZh.add(keyZh);seenEn.add(keyEn);
    const matches=existing.map(row=>({row,score:nearDuplicateScore(quote,{
      quoteZh:row.quoteZh??row.quote_zh,quoteEn:row.quoteEn??row.quote_en,
    })}))
      .filter(item=>item.score>=0.55).sort((a,b)=>b.score-a.score).slice(0,3)
      .map(item=>({score:Number(item.score.toFixed(3)),existing:mapQuote(item.row)}));
    if(matches.length)near.push({index,matches});
  }
  return {exact,near};
}

function validateBatchImport(data,allowDecisions=false) {
  const allowed=allowDecisions?['quotes','fillMissingScores','decisions']:['quotes','fillMissingScores'];
  if (!record(data) || Object.keys(data).some(key=>!allowed.includes(key)) ||
      !Array.isArray(data.quotes) || !Array.isArray(data.fillMissingScores) ||
      (data.decisions!==undefined&&!Array.isArray(data.decisions)) ||
      data.quotes.length > 80 || data.fillMissingScores.length > 80 ||
      (!data.quotes.length && !data.fillMissingScores.length)) fail('INVALID_INPUT');
  const quotes = data.quotes.map(row => {
    const quote = validateQuote(row);
    if (quote.id !== undefined) fail('INVALID_INPUT');
    if (quote.recommendationScore === null) quote.recommendationScore=autoRecommendationScore(quote);
    return quote;
  });
  const decisions=(data.decisions||[]).map(item=>{
    if(!record(item)||Object.keys(item).length!==2||!Number.isInteger(item.index)||item.index<0||
      item.index>=quotes.length||!['keep_existing','import_new'].includes(item.choice))fail('INVALID_INPUT');
    return item;
  });
  if(new Set(decisions.map(item=>item.index)).size!==decisions.length)fail('INVALID_INPUT');
  return {quotes,fillMissingScores:data.fillMissingScores.length ? validateScores({scores:data.fillMissingScores}) : [],decisions};
}

async function importQuotes(db, actorUid, data) {
  const input = validateBatchImport(data,true);
  const library = await rpc(db,'library_list',actorUid);
  const existing = Array.isArray(library.quotes) ? library.quotes : [];
  const comparison=compareBatchQuotes(input.quotes,existing);
  const exactIndexes=new Set(comparison.exact.map(item=>item.index));
  const nearIndexes=new Set(comparison.near.map(item=>item.index));
  const choices=new Map(input.decisions.map(item=>[item.index,item.choice]));
  for(const index of nearIndexes)if(!choices.has(index))fail('DAILY_INSPIRATION_REVIEW_REQUIRED');
  const additions=[];let duplicateCount=exactIndexes.size;
  for(let index=0;index<input.quotes.length;index++){
    if(exactIndexes.has(index))continue;
    if(nearIndexes.has(index)&&choices.get(index)==='keep_existing'){duplicateCount++;continue;}
    additions.push(input.quotes[index]);
  }

  const existingById = new Map(existing.map(row=>[String(row.id),row]));
  const scores = input.fillMissingScores.filter(item=>existingById.has(item.id) &&
    existingById.get(item.id).recommendation_score == null);
  let scoreUpdatedCount = 0;
  if (scores.length) {
    const result = await rpc(db,'scores_save',actorUid,{scores});
    scoreUpdatedCount = Number(result.updated) || 0;
  }

  let addedCount = 0;
  for (const quote of additions) {
    try {
      await rpc(db,'quote_save',actorUid,quote);
      addedCount++;
    } catch (_) {
      return {ok:false,partial:addedCount > 0 || scoreUpdatedCount > 0,addedCount,duplicateCount,scoreUpdatedCount};
    }
  }
  return {ok:true,addedCount,duplicateCount,scoreUpdatedCount};
}

async function previewImport(db,actorUid,data){
  const input=validateBatchImport(data);
  const library=await rpc(db,'library_list',actorUid);
  const existing=Array.isArray(library.quotes)?library.quotes:[];
  const comparison=compareBatchQuotes(input.quotes,existing);
  return {ok:true,quotes:input.quotes,exactDuplicates:comparison.exact,
    nearDuplicates:comparison.near,autoScored:input.quotes.filter(row=>data.quotes.some(source=>
      source.recommendationScore==null&&source.quoteZh===row.quoteZh&&source.quoteEn===row.quoteEn)).length,
    scores:input.fillMissingScores,
    existingScoreIds:existing.filter(row=>(row.recommendationScore??row.recommendation_score)==null).map(row=>String(row.id))};
}

async function currentOrChoose(db, actorUid, now = new Date(), retries = 0) {
  const library = await rpc(db,'library_list',actorUid);
  const settings = library.settings;
  const slot = displaySlot(settings, now);
  const {localDate, segment} = slot;
  const initial = await rpc(db,'current',actorUid,{localDate,segment});
  if (initial.quote) return {ok:true,quote:mapQuote(initial.quote),settings:initial.settings,...slot};
  if (!initial.candidates?.length) return {ok:true,quote:null,settings:initial.settings,...slot,noQuotes:true};
  const selected = await invokeSelection({date:localDate,segment,candidates:initial.candidates,
    currentQuoteId:initial.slot?.quoteId,actorUid});
  if (!selected) return {ok:true,quote:null,settings:initial.settings,...slot,noQuotes:true};
  let stored;
  try {stored=await rpc(db,'select',actorUid,{localDate,segment,quoteId:String(selected.id)});}
  catch(error){
    if(retries<2&&['DAILY_INSPIRATION_ROTATION_USED','DAILY_INSPIRATION_STALE','DAILY_INSPIRATION_NOT_AVAILABLE'].includes(error?.code))return currentOrChoose(db,actorUid,now,retries+1);
    throw error;
  }
  return {ok:true,quote:mapQuote(stored.quote),settings:stored.settings,...slot};
}

async function handleDailyInspiration(event, actorUid, options = {}) {
  const db = options.db || database();
  const action = event?.operation;
  if (!['current','replace','libraryList','quoteSave','quoteToggle','settingsSave','scoresSave','quoteBatchPreview','quoteBatchImport'].includes(action) ||
      Object.keys(event || {}).some(key => !['action','operation','data'].includes(key))) fail('INVALID_INPUT');
  if (action === 'libraryList') {
    if (event.data !== undefined) fail('INVALID_INPUT');
    const result=await rpc(db,'library_list',actorUid);
    return {ok:true,settings:result.settings,quotes:(result.quotes||[]).map(mapQuote)};
  }
  if (action === 'quoteSave') {
    const quote=validateQuote(event.data);
    if (quote.recommendationScore === null) quote.recommendationScore=autoRecommendationScore(quote);
    const result=await rpc(db,'quote_save',actorUid,quote);
    return {ok:true,quote:mapQuote(result.quote)};
  }
  if (action === 'scoresSave') {
    const scores=validateScores(event.data);
    return {ok:true,...await rpc(db,'scores_save',actorUid,{scores})};
  }
  if (action === 'quoteBatchImport') return importQuotes(db,actorUid,event.data);
  if (action === 'quoteBatchPreview') return previewImport(db,actorUid,event.data);
  if (action === 'quoteToggle') {
    const data=event.data;
    if (!record(data)||Object.keys(data).length!==2||!/^[1-9][0-9]{0,17}$/.test(String(data.id))||typeof data.enabled!=='boolean') fail('INVALID_INPUT');
    const result=await rpc(db,'quote_toggle',actorUid,{id:String(data.id),enabled:data.enabled});
    return {ok:true,quote:mapQuote(result.quote)};
  }
  if (action === 'settingsSave') {
    const data=event.data;
    if (!record(data)||![3,5].includes(Object.keys(data).length)||Object.keys(data).some(key=>!['timezone','firstPeriodStart','secondPeriodStart','minRecommendationScore','allowRepeatBeforeAllUsed'].includes(key))||
      typeof data.timezone!=='string'||data.timezone.length>80||
      (Object.hasOwn(data,'minRecommendationScore')&&(!Number.isInteger(data.minRecommendationScore)||data.minRecommendationScore<0||data.minRecommendationScore>10))||
      (Object.hasOwn(data,'allowRepeatBeforeAllUsed')&&typeof data.allowRepeatBeforeAllUsed!=='boolean')||
      (Object.hasOwn(data,'minRecommendationScore')!==Object.hasOwn(data,'allowRepeatBeforeAllUsed'))) fail('INVALID_INPUT');
    minutes(data.firstPeriodStart); minutes(data.secondPeriodStart);
    if (minutes(data.firstPeriodStart)>=minutes(data.secondPeriodStart)) fail('INVALID_INPUT');
    return {ok:true,...await rpc(db,'settings_save',actorUid,data)};
  }
  const started = Date.now();
  const now = options.now || new Date(started);
  const withRefresh = ({nextRefreshAt,...result}) => ({
    ...result, refreshInMs:Math.max(0, nextRefreshAt - now.getTime() - (Date.now() - started)),
  });
  const current=await currentOrChoose(db,actorUid,now);
  if (action === 'current' || !current.quote) return withRefresh(current);
  if (!record(event.data)||Object.keys(event.data).length!==1||String(event.data.expectedQuoteId)!==String(current.quote.id)) fail('INVALID_INPUT');
  const snapshot=await rpc(db,'current',actorUid,{localDate:current.localDate,segment:current.segment});
  const selected=await invokeSelection({date:current.localDate,segment:current.segment,
    candidates:snapshot.candidates || [],currentQuoteId:current.quote.id,actorUid});
  if (!selected) return withRefresh({...current,noAlternative:true});
  try {
    const stored=await rpc(db,'replace',actorUid,{localDate:current.localDate,segment:current.segment,
      quoteId:String(selected.id),expectedQuoteId:String(current.quote.id)});
    return withRefresh({...current,quote:mapQuote(stored.quote),settings:stored.settings});
  } catch (error) {
    if (['DAILY_INSPIRATION_STALE','DAILY_INSPIRATION_ROTATION_USED','DAILY_INSPIRATION_NOT_AVAILABLE'].includes(error?.code)) return withRefresh(await currentOrChoose(db,actorUid,now));
    throw error;
  }
}

module.exports={handleDailyInspiration,localClock,segmentFor,displaySlot,avoidPool,deterministicChoice,validateQuote,
  validateScores,validateBatchImport,normalizeQuoteText,autoRecommendationScore,mapQuote,
  similarity,nearDuplicateScore,compareBatchQuotes};
