'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M06 standalone resources page searches and pages without an activity, reuses forms and retries safely',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');
  await b.wait("document.querySelector('.more-section')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');window.m06={calls:[],fail:false};
   data.resourceDirectory=async(ctx,kind,args)=>{
    window.m06.calls.push({kind,...args});if(window.m06.fail)throw Error('RESOURCE_SEARCH_LIMIT');
    return{rows:kind==='speaker'?[{id:args.page,name:'[CRM_TEST_ONLY] Speaker '+args.page,person_id:22,linked_person:{id:22,name:'[CRM_TEST_ONLY] Person'},status:'active',relationship_stage:'new'}]:[{id:33,topic_name:'[CRM_TEST_ONLY] Topic',status:'active',keywords:[]}],hasMore:kind==='speaker'&&args.page===1,page:args.page,pageSize:20,total:null};
   };
   location.hash='#/activity-resources';
  })()`);
  await b.wait("document.querySelector('.resource-directory-results .pager')");
  assert.equal(await b.evaluate('window.m06.calls[0].kind'),'speaker');
  assert.match(await b.evaluate("document.querySelector('.resource-directory-results .row-title').innerText"),/新建/);
  await b.evaluate("document.querySelector('.resource-directory-results .pager button:last-child').click()");
  await b.wait("document.querySelector('.resource-directory-results .pager-info')?.innerText.includes('2')");
  assert.equal(await b.evaluate('window.m06.calls.at(-1).page'),2);
  assert.equal(await b.evaluate("document.querySelector('.resource-directory-results .pager button:last-child').disabled"),true);
  await b.evaluate(`(()=>{const form=document.querySelector('#console-main form');form.querySelector('select').value='topic';form.querySelector('input').value='[CRM_TEST_ONLY]';form.querySelectorAll('select')[1].value='active';form.requestSubmit()})()`);
  await b.wait("document.querySelector('.act-topic-catalog .act-resource-row')");
  assert.deepEqual(await b.evaluate('window.m06.calls.at(-1)'),{kind:'topic',keyword:'[CRM_TEST_ONLY]',status:'active',page:1,pageSize:20});
  assert.equal(await b.evaluate("document.querySelector('.act-topic-assignment')"),null);
  await b.evaluate("document.querySelector('.act-topic-catalog .act-resource-actions button').click()");
  await b.wait("document.querySelector('.sheet-overlay')");
  assert.match(await b.evaluate("document.querySelector('.sheet-overlay').innerText"),/主题/);
  await b.evaluate("document.querySelector('.sheet-overlay').remove();window.m06.fail=true;document.querySelector('#console-main form').requestSubmit()");
  await b.wait("document.querySelector('.resource-directory-results').innerText.includes('匹配扫描达到上限')");
  assert.equal(await b.evaluate("document.querySelector('.resource-directory-results .pager')"),null);
  await b.evaluate("window.m06.fail=false;document.querySelector('.resource-directory-results button').click()");
  await b.wait("document.querySelector('.act-topic-catalog .act-resource-row')");
  assert.equal(await b.evaluate('window.m06.calls.at(-1).keyword'),'[CRM_TEST_ONLY]');
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='activities'&&c.action==='get')"),false);
  for(const size of [{width:820,height:1180},{width:1180,height:820}]){
   await b.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  assert.equal(await b.evaluate("document.querySelector('#console-main a[href=\"/crm/admin.html#/speakers\"]')"), null);
  assert.equal(await b.evaluate("document.querySelector('#console-main a[href=\"/crm/admin.html#/topics\"]')"), null);
  await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');const {renderResourceDirectory}=await import('/crm/js/modules/console/activity-people.js');renderResourceDirectory({main:document.querySelector('#console-main')})})()`);
  await b.wait("document.querySelector('.page-title')?.textContent==='Speakers & Topics'");
  assert.match(await b.evaluate("document.querySelector('#console-main').innerText"),/Manage reusable resources/);
  await b.healthy();
 }finally{await b.close();}
});
