'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
for(const lang of ['zh-CN','en'])test(`L02 stage details, missing values and iPad (${lang})`,async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});
   const {data}=await import('/crm/js/modules/console/data.js');window.l02Calls=[];
   const old=data.funnelStats;data.funnelStats=()=>old({api:{call:async(name,args)=>{
    l02Calls.push(args);return {ok:true,funnels:[
     {key:'customer',total:2,stages:[{stage:'新认识',kind:'active',count:2,overdue:0,entered_30d:1,stuck:0}],testData:{status:'verified'}},
     {key:'opportunity',total:1,stages:[{stage:'成交',kind:'terminal',count:1,dwell_median_days:50,stuck:0}],testData:{status:'verified'}},
     {key:'recruit',total:0,stages:[{stage:'新增人才',kind:'active',count:0,overdue:0,entered_30d:0,moved_30d:null}],testData:{status:'verified'}}]};
   }}});location.hash='#/analytics';
  })()`);
  await b.wait("document.querySelectorAll('[data-stage-details]').length===3");
  assert.equal(await b.evaluate("l02Calls.every(x=>x.action==='stats'&&x.presentation==='stage_facts')"),true);
  await b.evaluate("document.querySelectorAll('[data-stage-details]').forEach(e=>e.open=true)");
  assert.equal(await b.evaluate("document.querySelector('[data-stage-details=customer] [data-stage-metric=overdue]').textContent"),'0');
  assert.equal(await b.evaluate("document.querySelector('[data-stage-details=customer] [data-stage-metric=stuck]').textContent"),lang==='en'?'Unknown':'未知');
  assert.equal(await b.evaluate("document.querySelector('[data-stage-details=opportunity] [data-stage-metric=dwell_median_days]').textContent"),lang==='en'?'Not applicable':'不适用');
  assert.equal(await b.evaluate("document.querySelector('#console-main a[href*=\"admin.html#/funnels\"]')"),null);
  assert.equal(await b.evaluate("document.querySelectorAll('[data-stage-details] th[title]').length"),18);
  for(const [width,height]of[[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const shot=await b.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.resolve(__dirname,`../security/.results/l02-${lang}.png`),Buffer.from(shot.data,'base64'));
  await b.healthy();
 }finally{await b.close();}
});
