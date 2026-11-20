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
