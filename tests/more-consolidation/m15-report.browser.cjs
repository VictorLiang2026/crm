'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('M15 unified report keeps dates, guards stale reads, and discloses source limits without writes',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-section')");
  const ranges=await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   const {validReportRange}=await import('/crm/js/modules/console/activity-report.js');
   window.m15={calls:[],fail:false,hold:false};
   data.activityReport=async(ctx,type,params)=>{m15.calls.push({type,...params});if(m15.fail)throw Error('Fictional read failure');
    const result={mode:params.mode,range:{start:params.startDate||'2026-10-24',end:params.endDate||'2026-10-24',days:1},
     totals:{newCustomers:2,followups:3,rcFollowups:4},daily:[],feedTotal:500,
     feed:[{day:'2026-10-24',name:'[CRM_TEST_ONLY] Fictional person',type:'Follow-up',detail:'[CRM_TEST_ONLY] Fictional source',sourceRef:{table:'followups',id:12,personId:980001,section:'timeline'}}],
     generatedAt:'2026-10-24T09:00:00Z',testData:{status:'verified',containsTestData:true,recordCount:1}};
    if(m15.hold){m15.hold=false;return new Promise(resolve=>m15.resolve=()=>resolve(result));}return result;};
   location.hash='#/activity-report';
   return [validReportRange('2024-01-01','2024-12-31'),validReportRange('2024-01-01','2025-01-01'),validReportRange('2026-02-30','2026-03-01'),validReportRange('2026-10-24','2026-10-23')];
  })()`);
  assert.deepEqual(ranges,[true,false,false,false]);
  await b.wait("location.hash==='#/activity-report/customer' && document.querySelector('[data-report-coverage]')");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('#console-main input[type=date]')].map(x=>x.value)"),['2026-10-24','2026-10-24']);
  assert.match(await b.evaluate("document.querySelector('#console-main').innerText"),/300[\s\S]*500/);
  await b.evaluate("(()=>{const x=document.querySelectorAll('#console-main input[type=date]');x[0].value='2026-10-01';x[1].value='2026-10-20';document.querySelector('[data-report-mode=range]').click();})()");
  await b.wait("location.hash.includes('startDate=2026-10-01&endDate=2026-10-20')");
  assert.equal(await b.evaluate("document.querySelector('[data-report-mode=range]').getAttribute('aria-pressed')"),'true');
  await b.evaluate("[...document.querySelectorAll('#console-main button')].find(x=>x.textContent==='组织发展').click()");
  await b.wait("location.hash.startsWith('#/activity-report/recruit?') && document.querySelector('[data-report-coverage=recruit]')");
  assert.deepEqual(await b.evaluate('m15.calls.at(-1)'),{type:'recruit',mode:'range',startDate:'2026-10-01',endDate:'2026-10-20'});
  const before=await b.evaluate('m15.calls.length');
  await b.evaluate("document.querySelectorAll('#console-main input[type=date]')[0].value='2026-10-21';document.querySelector('[data-report-mode=range]').click()");
  assert.equal(await b.evaluate('m15.calls.length'),before);
  assert.match(await b.evaluate("document.querySelector('[role=alert]').textContent"),/366/);
  await b.evaluate("m15.fail=true;document.querySelectorAll('#console-main input[type=date]')[0].value='2026-10-02';document.querySelector('[data-report-mode=range]').click()");
  await b.wait("document.querySelector('#console-main').textContent.includes('Fictional read failure')");
  assert.equal(await b.evaluate("document.querySelector('#console-main input[type=date]').value"),'2026-10-02');
  assert.match(await b.evaluate('location.hash'),/startDate=2026-10-01/);
  await b.evaluate("m15.fail=false;m15.hold=true;document.querySelector('[data-report-mode=range]').click()");
  await b.wait('typeof m15.resolve===\'function\'');
  await b.evaluate("document.querySelector('[data-report-mode=today]').click()");
  await b.wait("location.hash==='#/activity-report/recruit' && document.querySelector('[data-report-coverage]')");
  await b.evaluate('m15.resolve()');
  assert.equal(await b.evaluate('location.hash'),'#/activity-report/recruit');
  assert.equal(await b.evaluate("document.querySelector('[data-report-mode=today]').getAttribute('aria-pressed')"),'true');
  // Detached report response must not rewrite a different route.
  await b.evaluate("m15.hold=true;document.querySelector('[data-report-mode=today]').click()");
  await b.wait('m15.hold===false');await b.evaluate("location.hash='#/more'");await b.wait("document.querySelector('.more-section')");
  await b.evaluate('m15.resolve()');assert.equal(await b.evaluate('location.hash'),'#/more');
  for(const lang of ['en','zh-CN']){
   await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});location.hash='#/activity-report/customer';})()`);
   await b.wait("document.querySelector('[data-report-coverage=customer]')");
   assert.match(await b.evaluate("document.querySelector('#console-main').innerText"),lang==='en'?/Workload Reports/:/工作量报表/);
   for(const [width,height]of [[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await b.evaluate("[...document.querySelectorAll('[data-report-coverage],[data-report-limits]')].every(x=>getComputedStyle(x).whiteSpace!=='nowrap' && x.scrollWidth<=x.clientWidth+1)"),true);
    if(lang==='en'){const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../security/.results/m15-'+width+'.png'),Buffer.from(shot.data,'base64'));}
   }
   await b.evaluate("location.hash='#/more'");await b.wait("document.querySelector('.more-section')");
  }
  await b.healthy();
 }finally{await b.close();}
});
