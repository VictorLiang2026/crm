'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
for(const lang of ['zh-CN','en'])test(`L03 date shortcuts, paging, summaries and iPad (${lang})`,async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/ai','authCase=1');await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   history.replaceState(null,'',location.pathname+location.search+'#/ai/experience');
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});
   const {renderAiExperience}=await import('/crm/js/modules/console/ai-experience.js');
   window.l03Calls=[];renderAiExperience({root:document.querySelector('.console-main'),callFn:async(name,p)=>{
    l03Calls.push(p);
    if(p.operation==='targets')return {ok:true,actions:[],opportunities:[],activities:[],recruitFollowups:[]};
    if(p.operation!=='list')throw Error('Unexpected write');
    const f=p.filters,legacy=f.source==='legacy';return {ok:true,source:f.source,filters:f,
     tasks:[],results:[],decisions:[],outcomes:[],learnings:[],metrics:null,
     legacy:legacy?[{id:71,customer_name:'Fixture History',recommendation_date:'2026-10-01',
      suggested_followup_date:'2026-10-31',suggested_message:'Fixture message',suggested_strategy:'Fixture strategy',suggested_followup_goal:'约见面'}]:[],
     pagination:{page:f.page,limit:20,hasMore:f.page===1,dateField:f.dateField||(legacy?'recommendation_date':'created_at'),relatedTruncated:{}}};
   }});
  })()`);
  await b.wait("document.querySelector('.crm-ai-history-pager button')");
  const presets=await b.evaluate(`(async()=>{const {historyDatePreset:p}=await import('/crm/js/modules/console/ai-history-filters.js');
   const n=Date.parse('2026-12-31T16:30:00Z');return [p('today',n),p('overdue',n),p('next7',n)];})()`);
  assert.deepEqual(presets,[{startDate:'2027-01-01',endDate:'2027-01-01'},{endDate:'2026-12-31'},{startDate:'2027-01-02',endDate:'2027-01-08'}]);
  await b.evaluate("(()=>{document.querySelector('.ai-history-advanced').open=true;const s=document.querySelector('.ai-history-source');s.value='legacy';s.dispatchEvent(new Event('change'));document.querySelector('[data-history-preset=today]').click()})()");
  await b.wait("document.querySelector('.crm-ai-exp-detail').innerText.includes('Fixture message')");
  let filters=await b.evaluate("l03Calls.filter(x=>x.operation==='list').at(-1).filters");
  assert.equal(filters.dateField,'suggested_followup_date');assert.equal(filters.sortDir,'asc');assert.equal(filters.startDate,filters.endDate);
  const summaries=await b.evaluate("document.querySelector('.crm-ai-exp-result').innerText");
  for(const s of ['2026-10-01','2026-10-31','Fixture message','Fixture strategy'])assert.ok(summaries.includes(s));
  await b.evaluate("document.querySelector('.crm-ai-history-pager button:last-child').click()");
  await b.wait("l03Calls.filter(x=>x.operation==='list').at(-1).filters.page===2 && !document.querySelector('fieldset').disabled");
  filters=await b.evaluate("l03Calls.filter(x=>x.operation==='list').at(-1).filters");
  assert.equal(filters.dateField,'suggested_followup_date');assert.equal(filters.sortDir,'asc');
  await b.evaluate("document.querySelector('[data-history-preset=overdue]').click()");
  await b.wait("l03Calls.filter(x=>x.operation==='list').at(-1).filters.startDate===undefined && !document.querySelector('fieldset').disabled");
  await b.evaluate("document.querySelector('[data-history-preset=next7]').click()");
  await b.wait("!!l03Calls.filter(x=>x.operation==='list').at(-1).filters.startDate && !document.querySelector('fieldset').disabled");
  assert.equal(await b.evaluate("document.querySelector('.crm-ai-exp-detail a[href*=\"admin.html#/ai-suggestions\"]')"),null);
  for(const [width,height]of[[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,`../security/.results/l03-${lang}.png`),Buffer.from(shot.data,'base64'));
  await b.evaluate("(()=>{const s=document.querySelector('.ai-history-source');s.value='runtime';s.dispatchEvent(new Event('change'));document.querySelector('.crm-ai-history-filters').requestSubmit()})()");
  await b.wait("l03Calls.filter(x=>x.operation==='list').at(-1).filters.source==='runtime' && !document.querySelector('fieldset').disabled");
  assert.deepEqual(await b.evaluate("[...document.querySelector('.ai-history-date-axis').options].map(x=>x.value)"),['created_at']);
  assert.equal(await b.evaluate("document.querySelector('.ai-history-date-shortcuts').hidden"),true);
  assert.equal(await b.evaluate("l03Calls.some(x=>!['list','targets'].includes(x.operation))"),false);
  await b.healthy();
 }finally{await b.close();}
});
