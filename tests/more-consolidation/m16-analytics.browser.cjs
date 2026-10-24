'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('M16 fact-first analytics separates source scopes, requires explicit AI request and keeps facts on failure',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-section')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');const stats=data.funnelStats,explain=data.explainFunnels;
   window.m16={calls:[],failStats:false,failExplain:false,source:'rule'};
   const api={call:async(name,args)=>{m16.calls.push({name,...args});if(name!=='funnel_insight')throw Error('Unexpected service');
    if(args.action==='stats'){if(m16.failStats)throw Error('Fictional stats error');return {ok:true,generated_at:'2026-10-24T09:00:00Z',funnels:[
     {key:'customer',total:2,stages:[{stage:'新认识',kind:'active',count:2}],warnings:['[CRM_TEST_ONLY] Fictional warning'],metrics:[],testData:{status:'verified',containsTestData:true,recordCount:1}},
     {key:'opportunity',total:1,stages:[{stage:'成交',kind:'terminal',count:1}],warnings:[],metrics:[],testData:{status:'verified',containsTestData:false}},
     {key:'recruit',total:0,stages:[{stage:'新增人才',kind:'active',count:0}],warnings:[],metrics:[],testData:{status:'unverified'}}]};}
    if(args.action==='explain'){if(m16.failExplain)throw Error('Fictional interpretation error');return {ok:true,text:'[CRM_TEST_ONLY] <img src=x onerror=alert(1)> Fictional interpretation',source:m16.source,testData:{status:'verified',containsTestData:true,recordCount:1}};}
    throw Error('Unexpected write');}};
   data.funnelStats=async()=>{const result=await stats({api});if(m16.missing)result.funnels=result.funnels.filter(x=>x.key!=='recruit');return result;};
   data.explainFunnels=()=>explain({api});location.hash='#/analytics';
  })()`);
  await b.wait("document.querySelectorAll('[data-analytics-total]').length===3");
  assert.equal(await b.evaluate("m16.calls.length>=1 && m16.calls.every(x=>x.name==='funnel_insight' && x.action==='stats')"),true);
  assert.match(await b.evaluate("document.querySelector('[data-analytics-scope=opportunity]').textContent"),/不含Person-only/);
  assert.match(await b.evaluate("document.querySelector('[data-analytics-facts]').textContent"),/测试来源/);
  assert.equal(await b.evaluate("document.querySelectorAll('[data-analytics-total] a').length"),0);
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('#console-main .more-actions a')].map(x=>x.getAttribute('href'))"),['#/activity-report','#/recruit/goals','#/opportunities']);
  await b.evaluate("m16.failExplain=true;[...document.querySelectorAll('#console-main button')].find(x=>x.textContent==='请求解读').click()");
  await b.wait("document.querySelector('[data-analytics-explanation]').textContent.includes('Fictional interpretation error')");
  assert.equal(await b.evaluate("document.querySelectorAll('[data-analytics-total]').length"),3);
  await b.evaluate("m16.failExplain=false;[...document.querySelectorAll('#console-main button')].find(x=>x.textContent==='请求解读').click()");
  await b.wait("document.querySelector('[data-analytics-explanation]').textContent.includes('规则解读')");
  assert.equal(await b.evaluate("document.querySelector('[data-analytics-explanation] img')"),null);
  await b.evaluate("m16.source='ai';[...document.querySelectorAll('#console-main button')].find(x=>x.textContent==='请求解读').click()");
  await b.wait("document.querySelector('[data-analytics-explanation] b')?.textContent==='AI解读'");
  await b.evaluate("m16.failStats=true;document.querySelector('.head-actions button').click()");
  await b.wait("document.querySelector('#console-main').textContent.includes('Fictional stats error')");
  assert.equal(await b.evaluate("document.querySelectorAll('[data-analytics-total]').length"),3);
  assert.equal(await b.evaluate("document.querySelector('[data-analytics-explanation]').textContent"),'');
  assert.equal(await b.evaluate("m16.calls.every(x=>['stats','explain'].includes(x.action))"),true);
  for(const lang of ['en','zh-CN']){
   await b.evaluate("location.hash='#/more'");await b.wait("document.querySelector('.more-section')");
   await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});m16.failStats=false;location.hash='#/analytics';})()`);
   await b.wait("document.querySelectorAll('[data-analytics-total]').length===3");
   assert.match(await b.evaluate("document.querySelector('#console-main').textContent"),lang==='en'?/Business Insights/:/经营分析/);
   for(const[width,height]of[[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    if(lang==='en'){const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../security/.results/m16-'+width+'.png'),Buffer.from(shot.data,'base64'));}
   }
  }
  await b.evaluate("m16.missing=true;document.querySelector('.head-actions button').click()");
  await b.wait("document.querySelectorAll('[data-analytics-total]').length===2");
  assert.match(await b.evaluate("document.querySelector('[data-analytics-scope=recruit]').parentElement.textContent"),/未返回该类数据/);
  await b.healthy();
 }finally{await b.close();}
});
