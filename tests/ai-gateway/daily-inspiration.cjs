'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const service=require('../../cloudfunctions/assistant/daily-inspiration-service');

const settings={timezone:'Asia/Shanghai',firstPeriodStart:'01:00',secondPeriodStart:'12:00'};

test('local date and period follow the configured timezone boundaries',()=>{
  const beforeNoon=service.localClock(settings.timezone,new Date('2026-11-20T03:59:00Z'));
  const noon=service.localClock(settings.timezone,new Date('2026-11-20T04:00:00Z'));
  assert.equal(beforeNoon.date,'2026-11-20');
  assert.equal(service.segmentFor(beforeNoon.minute,settings),'first');
  assert.equal(service.segmentFor(noon.minute,settings),'second');
  assert.equal(service.segmentFor(30,settings),'second');
});

test('repeat avoidance relaxes to the fourteen-day window and excludes current quote',()=>{
  const now=Date.parse('2026-11-20T00:00:00Z');
  const rows=[
    {id:'1',lastShownAt:'2026-11-19T00:00:00Z'},
    {id:'2',lastShownAt:'2026-11-01T00:00:00Z'},
    {id:'3',lastShownAt:null},
  ];
  const pool=service.avoidPool(rows,'3',now);
  assert.deepEqual(pool.map(row=>row.id),['2']);
  assert.deepEqual(service.avoidPool([{id:'9'}],'9',now),[]);
});

test('deterministic fallback is stable for a user, date, and period',()=>{
  const rows=[{id:'4'},{id:'7'},{id:'11'}];
  assert.equal(service.deterministicChoice(rows,'2026-11-20','first','user-a'),service.deterministicChoice(rows,'2026-11-20','first','user-a'));
  assert.notEqual(service.deterministicChoice(rows,'2026-11-20','first','user-a'),service.deterministicChoice(rows,'2026-11-20','first','user-b'));
});

test('quote validation rejects unsupported themes and non-HTTPS citations',()=>{
  const input={quoteZh:'先了解客户的真实需要',quoteEn:'Understand the client’s real needs first.',
    theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'Research summary',
    sourceUrl:'https://www.limra.com/research',editorialRewrite:true};
  assert.equal(service.validateQuote(input).theme,'customer_trust');
  assert.throws(()=>service.validateQuote({...input,sourceUrl:'javascript:alert(1)'}),error=>error.code==='INVALID_INPUT');
  assert.throws(()=>service.validateQuote({...input,theme:'unclassified'}),error=>error.code==='INVALID_INPUT');
});

test('missing recommendation score is deterministic and bounded',()=>{
  const quote={quoteZh:'先理解客户，再帮助客户行动。',quoteEn:'Listen first, then help clients act.',
    theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'Research summary',sourceUrl:'https://www.limra.com/research',editorialRewrite:true};
  assert.equal(service.validateQuote(quote).recommendationScore,null);
  const score=service.autoRecommendationScore(quote);
  assert.ok(Number.isInteger(score)&&score>=0&&score<=10);
  assert.equal(service.validateBatchImport({quotes:[quote],fillMissingScores:[]}).quotes[0].recommendationScore,score);
  assert.throws(()=>service.validateQuote({...quote,recommendationScore:11}),error=>error.code==='INVALID_INPUT');
});

test('batch comparison separates exact and near duplicates from new content',()=>{
  const existing=[{id:12,quote_zh:'建立持久的客户关系',quote_en:'Build lasting client relationships.',
    theme:'customer_trust',source_org:'LIMRA',source_title:'Research',source_url:'https://limra.com',recommendation_score:8}];
  const quotes=[
    {quoteZh:'建立持久的客户关系。',quoteEn:'Build lasting client relationships!',recommendationScore:8},
    {quoteZh:'建立持久的客户关系，并持续提供支持。',quoteEn:'Build lasting client relationships and support them.',recommendationScore:8},
    {quoteZh:'持续培养团队能力。',quoteEn:'Develop team capability over time.',recommendationScore:8},
  ];
  const compared=service.compareBatchQuotes(quotes,existing);
  assert.deepEqual(compared.exact.map(item=>item.index),[0]);
  assert.ok(compared.near.some(item=>item.index===1));
  assert.ok(!compared.near.some(item=>item.index===2));
});

test('near duplicate imports require a human choice and can keep or import explicitly',async()=>{
  const existing={id:12,quote_zh:'建立持久的客户关系',quote_en:'Build lasting client relationships.',
    theme:'customer_trust',source_org:'LIMRA',source_title:'Research',source_url:'https://limra.com',recommendation_score:8};
  const incoming={quoteZh:'建立持久的客户关系，并持续提供支持。',quoteEn:'Build lasting client relationships and support them.',
    theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'New edition',sourceUrl:'https://limra.com/new',editorialRewrite:true,recommendationScore:8};
  const db={async rpc(name,args){
    if(args.p_operation==='library_list')return {data:{quotes:[existing],settings}};
    if(args.p_operation==='quote_save')return {data:{quote:{id:13,...args.p_data}}};
  }};
  await assert.rejects(()=>service.handleDailyInspiration({operation:'quoteBatchImport',data:{quotes:[incoming],fillMissingScores:[]}},'uid',{db}),
    error=>error.code==='DAILY_INSPIRATION_REVIEW_REQUIRED');
  const keep=await service.handleDailyInspiration({operation:'quoteBatchImport',data:{quotes:[incoming],fillMissingScores:[],decisions:[{index:0,choice:'keep_existing'}]}},'uid',{db});
  assert.deepEqual(keep,{ok:true,addedCount:0,duplicateCount:1,scoreUpdatedCount:0});
  const add=await service.handleDailyInspiration({operation:'quoteBatchImport',data:{quotes:[incoming],fillMissingScores:[],decisions:[{index:0,choice:'import_new'}]}},'uid',{db});
  assert.deepEqual(add,{ok:true,addedCount:1,duplicateCount:0,scoreUpdatedCount:0});
});

test('settings preserve legacy period-only saves and validate expanded controls',async()=>{
  const calls=[];
  const db={async rpc(name,args){calls.push(args);return {data:{settings:{timezone:'Asia/Shanghai'}}};}};
  const legacy={timezone:'Asia/Shanghai',firstPeriodStart:'01:00',secondPeriodStart:'12:00'};
  await service.handleDailyInspiration({operation:'settingsSave',data:legacy},'uid',{db});
  assert.deepEqual(calls[0].p_data,legacy);
  await service.handleDailyInspiration({operation:'settingsSave',data:{...legacy,minRecommendationScore:8,allowRepeatBeforeAllUsed:true}},'uid',{db});
  assert.equal(calls[1].p_data.minRecommendationScore,8);
  assert.equal(calls[1].p_data.allowRepeatBeforeAllUsed,true);
  await assert.rejects(()=>service.handleDailyInspiration({operation:'settingsSave',data:{...legacy,minRecommendationScore:11,allowRepeatBeforeAllUsed:false}},'uid',{db}),
    error=>error.code==='INVALID_INPUT');
});

test('batch import skips bilingual duplicates and fills only null existing scores',async()=>{
  const quote={quoteZh:'先理解客户，再帮助客户行动。',quoteEn:'Listen first, then help clients act.',
    theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'Research summary',sourceUrl:'https://www.limra.com/research',editorialRewrite:true,recommendationScore:8};
  const calls=[];
  const db={async rpc(name,args){
    calls.push(args);
    if(args.p_operation==='library_list')return {data:{quotes:[
      {id:1,quote_zh:quote.quoteZh,quote_en:quote.quoteEn,recommendation_score:null},
      {id:2,quote_zh:'另一个已有句子',quote_en:'Another existing line',recommendation_score:7},
    ],settings}};
    if(args.p_operation==='scores_save')return {data:{updated:1}};
    if(args.p_operation==='quote_save')return {data:{quote:{id:3,...args.p_data}}};
  }};
  const result=await service.handleDailyInspiration({operation:'quoteBatchImport',data:{
    quotes:[quote,{...quote,quoteZh:'另一种中文翻译',quoteEn:'Another new English line.'}],
    fillMissingScores:[{id:'1',recommendationScore:9},{id:'2',recommendationScore:10},{id:'999',recommendationScore:8}],
  }},'verified-uid',{db});
  assert.deepEqual(result,{ok:true,addedCount:1,duplicateCount:1,scoreUpdatedCount:1});
  assert.equal(calls.find(call=>call.p_operation==='scores_save').p_data.scores.length,1);
  assert.equal(calls.filter(call=>call.p_operation==='quote_save').length,1);
  assert.ok(calls.every(call=>call.p_actor_uid==='verified-uid'));
});

test('batch import reports safe-to-retry partial progress when a save fails',async()=>{
  const base={quoteZh:'持续培养团队能力。',quoteEn:'Build the team over time.',theme:'team_growth',
    sourceOrg:'GAMA Global',sourceTitle:'Leadership',sourceUrl:'https://gamaglobal.org/leadership',editorialRewrite:true};
  let writes=0;
  const db={async rpc(name,args){
    if(args.p_operation==='library_list')return {data:{quotes:[],settings}};
    if(args.p_operation==='quote_save'){writes++;if(writes===2)return {error:{code:'FAILED'}};return {data:{quote:{id:10,...args.p_data}}};}
  }};
  const result=await service.handleDailyInspiration({operation:'quoteBatchImport',data:{quotes:[base,{...base,quoteZh:'成就来自持续学习。',quoteEn:'Progress comes from learning.'}],fillMissingScores:[]}},'uid',{db});
  assert.deepEqual(result,{ok:false,partial:true,addedCount:1,duplicateCount:0,scoreUpdatedCount:0});
});

test('current stable slot is served without a model call',async()=>{
  const quote={id:5,quote_zh:'先理解真实需要',quote_en:'Understand the real need first.',theme:'customer_trust',
    source_org:'LIMRA',source_title:'Research',source_url:'https://www.limra.com/research',
    editorial_rewrite:true,enabled:true};
  const calls=[];
  const db={async rpc(name,args){
    calls.push({name,args});
    return {data:name==='crm_daily_inspiration_v1'
      ? args.p_operation==='library_list'?{settings,quotes:[]}:{settings,quote,slot:{quoteId:5},candidates:[]}
      : null};
  }};
  const result=await service.handleDailyInspiration({operation:'current'},'verified-uid',
    {db,now:new Date('2026-11-20T03:00:00Z')});
  assert.equal(result.ok,true);
  assert.equal(result.quote.id,'5');
  assert.equal(result.quote.quoteZh,'先理解真实需要');
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.args.p_actor_uid==='verified-uid'));
});
