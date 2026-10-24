'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M03 follow-up date links select timeline without row override; legacy tools stay contextual',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   window.m03Queries=[];
   data.listPeople=async(ctx,args)=>{window.m03Queries.push(args);return {rows:[{
    id:980001,display_name:'[CRM_TEST_ONLY]客户甲',customer_id:71,roles:['customer'],customer_stage:'初步接触',
    latest_followup_date:'2026-10-01',next_followup_date:'2026-10-28',updated_at:'2026-10-24'
   },{id:980002,display_name:'[CRM_TEST_ONLY]空日期',roles:[]}],page:1,pageSize:20,total:2,totalPages:1,hasMore:false}};
   location.hash='#/people';
  })()`);
  await b.wait("document.querySelector('.people-table tbody tr')");
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-legacy-tools')).display"),'none');
  assert.equal(await b.evaluate("document.querySelectorAll('.people-table tbody tr:nth-child(2) .people-col-next_followup a').length"),0);
  assert.equal(await b.evaluate("document.querySelector('.people-table tbody .people-col-updated_at a')"),null);
  const href=await b.evaluate("document.querySelector('.people-table tbody .people-col-next_followup a').getAttribute('href')");
  assert.equal(href,'#/person/980001/timeline');
  await b.evaluate("document.querySelector('.people-table tbody .people-col-next_followup a').click()");
  await b.wait("location.hash==='#/person/980001/timeline' && document.querySelector('.tabs .tab.active')");
  assert.equal(await b.evaluate("[...document.querySelectorAll('.tabs .tab')].findIndex(x=>x.classList.contains('active'))"),1);
  await b.evaluate('history.back()');await b.wait("document.querySelector('.people-table tbody')");
  await b.evaluate("[...document.querySelectorAll('.toolbar button')].find(x=>x.textContent.includes('客户经营视图')).click()");
  await b.wait("window.m03Queries.at(-1).includeCustomerStage===true");
  assert.equal(await b.evaluate("document.querySelector('.people-legacy-tools').hidden"),false);
  assert.notEqual(await b.evaluate("getComputedStyle(document.querySelector('.people-legacy-tools')).display"),'none');
  assert.equal(await b.evaluate("document.querySelector('.people-legacy-tools').getAttribute('href')"),'/crm/admin.html#/customers');
  assert.equal(await b.evaluate("document.querySelector('.people-col-customer_stage')!==null"),true);
  await b.evaluate("[...document.querySelectorAll('.toolbar button')].find(x=>x.textContent.includes('全部人物')).click()");
  await b.wait("window.m03Queries.at(-1).includeCustomerStage===false");
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-legacy-tools')).display"),'none');
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['create','update','execute','remove'].includes(c.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
