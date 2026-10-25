'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M13 filters and pages on server, waits for Person choice, keeps failed views, and isolates colliding legacy IDs',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/ai','authCase=1');await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   history.replaceState(null,'',location.pathname+location.search+'#/ai/experience');
   window.m13={calls:[],fail:false,decisions:[],legacy:false};
   window.m13Call=async(name,p)=>{m13.calls.push({name,p});
    if(name==='person_360'&&p.action==='resolveIdentity')return {candidates:[{id:71,displayName:'虚构同名甲'},{id:72,displayName:'虚构同名乙'}]};
    if(name!=='assistant')throw Error('unexpected');
    if(p.operation==='targets')return {ok:true,actions:[],opportunities:[],activities:[],recruitFollowups:[]};
    if(p.operation==='list'){
      if(m13.fail)throw Error('read failed');
      const f=p.filters||{source:'runtime',page:1,limit:20};
      const legacy=f.source==='legacy',page=f.page||1;
      return {ok:true,source:f.source,filters:f,tasks:legacy?[]:[{id:61,task_type:'meeting_prep',subject_type:'person',subject_id:'72',created_at:'2026-10-24T01:00:00Z'}],
       results:legacy?[]:[{id:71,task_id:61,result_json:{brief30Seconds:'[CRM_TEST_ONLY] New result page '+page}}],decisions:m13.decisions,outcomes:[],learnings:[],
       legacy:legacy?[{id:71,customer_id:301,customer_name:'[CRM_TEST_ONLY] Historical snapshot',recommendation_date:'2026-10-20',suggested_message:'[CRM_TEST_ONLY] Old advice',nba:{status:'completed'},source:{table:'ai_recommendations',id:'71'}}]:[],
       metrics:legacy?null:{numerator:1,denominator:2,pending:1},pagination:{page,limit:20,hasMore:page===1,total:null,unit:legacy?'recommendation':'task',relatedTruncated:{results:!legacy&&page===2}}};
    }
    if(p.operation==='decide'){m13.decisions.unshift({id:p.eventId,ai_result_id:p.aiResultId,decision:p.decision});return {ok:true,eventId:p.eventId};}
    throw Error('unexpected operation '+p.operation);
   };
   window.m13render=async lang=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(lang);
    const {renderAiExperience}=await import('/crm/js/modules/console/ai-experience.js');
    renderAiExperience({root:document.querySelector('.console-main'),callFn:m13Call});};
   await m13render('zh-CN');
  })()`);
  await b.wait("document.querySelector('.crm-ai-exp-readable')?.textContent.includes('New result page 1')");
  await b.wait("getComputedStyle(document.querySelector('.crm-ai-exp-workspace')).display==='grid'");
  assert.equal(await b.evaluate("document.querySelector('.ai-history-advanced').open"),false);
  assert.match(await b.evaluate("document.querySelector('.crm-ai-exp-detail').innerText"),/采纳不等于已执行/);
  assert.match(await b.evaluate("document.querySelector('.crm-ai-exp-metrics').innerText"),/全局反馈指标/);
  await b.evaluate("document.querySelector('.ai-history-advanced').open=true;document.querySelector('.ai-history-person-name').value='虚构同名';document.querySelector('.ai-history-find-person').click()");
  await b.wait("document.querySelector('.ai-history-person-choice').options.length===3");
  assert.equal(await b.evaluate("document.querySelector('.ai-history-person-choice').value"),'');
  const count=await b.evaluate("m13.calls.filter(x=>x.p.operation==='list').length");
  await b.evaluate("document.querySelector('.crm-ai-history-filters').requestSubmit()");
  assert.equal(await b.evaluate("m13.calls.filter(x=>x.p.operation==='list').length"),count);
  await b.evaluate("document.querySelector('.ai-history-person-choice').value='72';document.querySelector('.ai-history-type').value='meeting_prep';document.querySelector('.ai-history-from').value='2026-10-01';document.querySelector('.ai-history-to').value='2026-10-24';document.querySelector('.crm-ai-history-filters').requestSubmit()");
  await b.wait("m13.calls.some(x=>x.p.filters?.personId==='72')&&!document.querySelector('.crm-ai-history-filters fieldset').disabled");
  const filters=await b.evaluate("m13.calls.filter(x=>x.p.operation==='list').at(-1).p.filters");
  assert.deepEqual(filters,{source:'runtime',page:1,limit:20,type:'meeting_prep',personId:'72',startDate:'2026-10-01',endDate:'2026-10-24'});
  await b.evaluate("document.querySelectorAll('.crm-ai-history-pager button')[1].click()");
  await b.wait("document.querySelector('.crm-ai-exp-readable')?.textContent.includes('New result page 2')");
  assert.match(await b.evaluate("document.querySelector('.crm-ai-history-pager').innerText"),/读取上限/);
  const page2=await b.evaluate("m13.calls.filter(x=>x.p.operation==='list').at(-1).p.filters");assert.equal(page2.page,2);assert.equal(page2.personId,'72');
  await b.evaluate("m13.fail=true;document.querySelector('.ai-history-source').value='legacy';document.querySelector('.ai-history-source').dispatchEvent(new Event('change'));document.querySelector('.crm-ai-history-filters').requestSubmit()");
  await b.wait("document.querySelector('.crm-ai-exp-error')?.textContent.includes('当前已显示')");
  assert.match(await b.evaluate("document.querySelector('.crm-ai-exp-readable').textContent"),/page 2/);
  assert.match(await b.evaluate("document.querySelector('.crm-ai-history-pager').textContent"),/新 AI 结果与反馈/);
  await b.evaluate("m13.fail=false;document.querySelector('.crm-ai-history-filters').requestSubmit()");
  await b.wait("document.querySelector('.crm-ai-exp-detail')?.textContent.includes('Old advice')");
  assert.equal(await b.evaluate("document.querySelectorAll('.crm-ai-exp-detail form,.crm-ai-exp-result input[type=checkbox],.crm-ai-exp-lower form').length"),0);
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.crm-ai-exp-lower')).display"),'none');
  assert.match(await b.evaluate("document.querySelector('.crm-ai-exp-detail').innerText"),/public.ai_recommendations #71/);
  assert.equal(await b.evaluate("document.querySelector('.crm-ai-exp-raw').open"),false);
  assert.equal(await b.evaluate("m13.calls.some(x=>['decide','outcome','learning','confirmLearning'].includes(x.p.operation))"),false);
  assert.equal(await b.evaluate("document.querySelector('.crm-ai-exp-detail a[href*=\"admin.html#/ai-suggestions\"]')"),null);
  for(const lang of ['en','zh-CN']){
   await b.evaluate('m13render('+JSON.stringify(lang)+')');await b.wait("document.querySelector('.crm-ai-exp-readable')");
   for(const [width,height]of [[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.evaluate("document.querySelector('.ai-history-advanced').open=true");
    assert.equal(await b.evaluate("parseFloat(getComputedStyle(document.querySelector('.ai-history-person-name')).borderTopWidth)>=1"),true,'visible input boundary');
    assert.equal(await b.evaluate("document.querySelector('.crm-ai-exp-metrics p').getBoundingClientRect().width>document.querySelector('.crm-ai-exp-metrics').getBoundingClientRect().width*.8"),true,'metric explanation has readable width');
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,lang+' '+width);
   }
  }
  await b.healthy();
 }finally{await b.close();}
});
