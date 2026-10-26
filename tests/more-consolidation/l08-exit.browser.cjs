'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
const ROOT=path.resolve(__dirname,'../..');

test('L08 Person cadence is lazy, bilingual, read-only and distinguishes missing evidence from stable',async()=>{
 const b=new Browser(ROOT);
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
   const {personCadence}=await import('/crm/js/modules/console/person-cadence.js');
   const {setLang}=await import('/crm/js/modules/console/i18n.js');window.l08Lang=setLang;
   window.l08={calls:[],status:'signal',fail:false,confidence:0.7};
   window.l08ctx={main:document.querySelector('#console-main'),api:{call:async(name,args)=>{
     l08.calls.push({name,...args});if(l08.fail)throw Error('TEST_READ_FAILED');
     return {status:l08.status,why:'[CRM_TEST_ONLY] Original source explanation',recommended_action:'[CRM_TEST_ONLY] Human decision',confidence:l08.confidence,
       evidence:{elapsed_days:40,cadence_days:10,observation_days:30,interaction_count:7,importance_source:'sales_priority_proxy'},
       testData:{containsTestData:true,status:'verified'}};
   }}};
   window.l08Render=()=>l08ctx.main.replaceChildren(personCadence(l08ctx,71));l08Render();
  })()`);
  assert.equal(await b.evaluate('l08.calls.length'),0);
  for(const lang of ['zh-CN','en'])for(const state of ['signal','stable','insufficient_evidence']){
   await b.evaluate(`l08Lang(${JSON.stringify(lang)});l08.status=${JSON.stringify(state)};l08Render()`);
   const before=await b.evaluate('l08.calls.length');
   await b.evaluate("document.querySelector('.person-cadence > summary').click()");
   await b.wait(`l08.calls.length===${before+1} && document.querySelector('.person-cadence-body b')`);
   const text=await b.evaluate("document.querySelector('.person-cadence-body').textContent");
   assert.ok(!text.includes('l08_'));
   assert.match(text,lang==='en'?/does not create Actions/:/不会自动创建行动/);
   if(state==='insufficient_evidence')assert.match(text,lang==='en'?/Insufficient Evidence/:/证据不足/);
   else assert.ok(text.includes('70%'));
   assert.ok(text.includes('[CRM_TEST_ONLY] Original source explanation'));
   for(const width of [820,1180]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height:width===820?1180:820,deviceScaleFactor:2,mobile:false});
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await b.evaluate("document.querySelector('.person-cadence>summary').getBoundingClientRect().height>=44"),true);
    if(state==='signal'){
     const shot=await b.send('Page.captureScreenshot',{format:'png'});
     fs.writeFileSync(path.join(ROOT,`tests/security/.results/l08-cadence-${lang}-${width}.png`),Buffer.from(shot.data,'base64'));
    }
   }
  }
  await b.evaluate("l08.fail=true;l08Render();document.querySelector('.person-cadence > summary').click()");
  await b.wait("document.querySelector('.person-cadence .error-box')");
  await b.evaluate("l08.fail=false;l08.status='stable';document.querySelector('.person-cadence .error-box button').click()");
  await b.wait("document.querySelector('.person-cadence-body b')?.textContent.includes('No Clear Departure')");
  await b.evaluate("l08.status='unexpected';l08Render();document.querySelector('.person-cadence > summary').click()");
  await b.wait("document.querySelector('.person-cadence .error-box')");
  assert.equal(await b.evaluate("l08.calls.every(x=>x.name==='person_360'&&x.action==='getRelationshipDecay'&&x.personId===71)"),true);
  await b.healthy();
 }finally{await b.close();}
});

test('L08 native Person overview exposes cadence without a duplicate full-profile link',async()=>{
 const b=new Browser(ROOT);
 try{
  await b.start();await b.openConsole('#/person/980001','authCase=1');
  await b.wait("document.querySelector('.person-cadence')");
  assert.equal(await b.evaluate("document.querySelector('#console-main a[href^=\"/crm/admin.html#/person/\"]')"),null);
  assert.equal(await b.evaluate("window.__crmTest.calls.some(x=>x.action==='getRelationshipDecay')"),false);
  await b.evaluate("document.querySelector('.person-cadence > summary').click()");
  await b.wait("window.__crmTest.calls.some(x=>x.action==='getRelationshipDecay')");
  await b.healthy();
 }finally{await b.close();}
});

test('L08 historical opportunity maintenance remains explicit and collapsed for active, terminal and unlinked records',async()=>{
 const b=new Browser(ROOT);
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
    const {renderOpportunities}=await import('/crm/js/modules/console/pages/opportunities.js');
    const {setLang}=await import('/crm/js/modules/console/i18n.js');window.l08Lang=setLang;
    window.l08opp={calls:[],status:'发现',person:{id:71,display_name:'[CRM_TEST_ONLY] Fictional'}};
    window.l08oppRender=()=>renderOpportunities({main:document.querySelector('#console-main'),toast(){},api:{call:async(name,args)=>{
      l08opp.calls.push({name,...args});const row={id:91,customer_id:301,person_id:null,person:l08opp.person,status:l08opp.status,opportunity_type:'医疗保障'};
      if(name==='funnel_insight')return{funnels:[]};
      if(args.action==='listPendingOpportunityCandidates')return{rows:[]};
      if(args.action==='listOpportunityDirectory')return{rows:[row],page:1,pageSize:20,total:1,hasMore:false,countsByStatus:{[row.status]:1}};
      if(args.action==='getOpportunityDirectoryDetails')return{opportunity:row,actions:[],outcomes:[]};
      throw Error('Unexpected '+args.action);
    }}});
  })()`);
  for(const lang of ['zh-CN','en'])for(const mode of ['active','terminal','unlinked']){
    await b.evaluate(`l08Lang(${JSON.stringify(lang)});l08opp.status=${JSON.stringify(mode==='terminal'?'成交':'发现')};l08opp.person=${mode==='unlinked'?'null':"{id:71,display_name:'[CRM_TEST_ONLY] Fictional'}"};l08oppRender()`);
    await b.wait("document.querySelector('.opp-row-main')");await b.evaluate("document.querySelector('.opp-row-main').click()");
    await b.wait("document.querySelector('.opp-maintenance')");
    assert.equal(await b.evaluate("document.querySelector('.opp-maintenance').open"),false);
    assert.equal(await b.evaluate("document.querySelector('.opp-maintenance a').getAttribute('href')"),'/crm/admin.html#/customer/301');
    assert.equal(await b.evaluate("!!document.querySelector('.legacy-opp-edit')"),mode==='active');
    const note=await b.evaluate("document.querySelector('.opp-maintenance p').textContent");
    assert.match(note,mode==='unlinked'?/Person/:lang==='en'?/soft deletion/:/软删除/);
    await b.evaluate("document.querySelector('.opp-maintenance summary').click()");
    for(const width of [820,1180]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height:width===820?1180:820,deviceScaleFactor:2,mobile:false});
      assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    }
    await b.evaluate("document.querySelector('.sheet-overlay').remove()");
  }
  assert.equal(await b.evaluate("l08opp.calls.some(x=>/execute|remove|create|update/i.test(x.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
