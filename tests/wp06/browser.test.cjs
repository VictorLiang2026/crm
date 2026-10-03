'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('timeline pages, source and context columns remain usable at phone width',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/person/980001');
  await b.wait("document.querySelector('.person360-timeline')?.innerText.includes('虚构客户跟进')");
  await b.evaluate(`(async()=>{
   const mod=await import('/crm/js/modules/person-insights.js');
   const root=document.getElementById('view');root.replaceChildren();window.wp06Pages=[];window.wp06OldTab=null;
   mod.renderPersonInsights({root,personId:980001,customerId:910001,isCurrent:()=>true,
    openLegacyTab:(id,tab)=>window.wp06OldTab=[id,tab],callFn:async(_name,event)=>{
     if(event.action==='getContextGroups')return {groups:{fact:[{category:'偏好',content:'【系统测试·勿联系】虚构事实',source:'public.context_items#101',confirmed:true,updatedAt:'2026-09-29'}],
      signal:[{category:'兴趣',content:'【系统测试·勿联系】虚构信号',source:'public.context_items#102',confirmed:false,updatedAt:'2026-09-28'}],
      inference:[{category:'推断',content:'【系统测试·勿联系】虚构推断',source:'public.context_items#103',confirmed:false,updatedAt:'2026-09-27'}]},
      testData:{status:'verified',containsTestData:true,recordCount:1,sources:[{batchKey:'crm_test_fixture',table:'context_items',count:1}]}};
     window.wp06Pages.push(event.page);return {page:event.page,pageSize:10,hasMore:event.page===1,
      rows:[{id:'followups:'+event.page,type:'followup',at:'2026-09-29',summary:'【系统测试·勿联系】虚构跟进 '+event.page,
       source:'public.followups#'+event.page,customerId:910001}],testData:{status:'verified',containsTestData:true,recordCount:1,
       sources:[{batchKey:'crm_test_fixture',table:'followups',count:1}]}};
    }});
  })()`);
  await b.wait("document.querySelector('.person360-timeline')?.innerText.includes('虚构跟进 1')");
  assert.equal(await b.evaluate("document.querySelectorAll('.person360-context-column').length"),3);
  assert.equal(await b.evaluate("document.querySelector('.person360-context').innerText.includes('未确认候选')"),true);
  assert.equal(await b.evaluate("document.querySelector('.person360-timeline').innerText.includes('含测试数据')"),true);
  await b.click('.person360-timeline-nav button','下一页');
  await b.wait("document.querySelector('.person360-timeline')?.innerText.includes('虚构跟进 2')");
  assert.deepEqual(await b.evaluate('window.wp06Pages'),[1,2]);
  await b.click('.person360-timeline-item a','到旧跟进页');
  assert.deepEqual(await b.evaluate('window.wp06OldTab'),[910001,'followups']);
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await b.evaluate("(()=>{const x=document.querySelector('.person360-context'),r=x.getBoundingClientRect();return x.scrollWidth<=x.clientWidth+1&&r.right<=innerWidth+1})()"),true);
  await b.healthy();
 }finally{await b.close();}
});
