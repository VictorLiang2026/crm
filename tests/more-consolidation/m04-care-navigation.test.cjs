'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M04 same-Person insurance, attachments and OCR links preserve review and customer-role boundaries',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');window.m04Data=data;window.m04Reads=[];
   data.insurance=async()=>({legacyCustomerId:null,evidenceStatus:'recorded',existingCoverage:[],gaps:[]});
   data.personProducts=async()=>({customerId:null,rows:[]});
   data.customerProfile=async()=>({status:'linked',customerId:71,fields:{customer_name:'[CRM_TEST_ONLY]客户甲'}});
   for(const method of ['gifts','photos','ocrRecords'])data[method]=async(ctx,id)=>{window.m04Reads.push({method,id});return{rows:[],hasMore:false}};
   data.ocrParseCommands=async()=>[];
   data.fileImports=async(ctx,id)=>{if(String(id)!=='980001')throw Error('Wrong import Person');return{rows:[],hasMore:false}};
   data.conversationPlaybookHistory=async()=>({ok:true,hasResult:false});
   location.hash='#/person/980001/insurance';
  })()`);
  await b.wait("document.querySelector('.insurance-workspace-links')");
  assert.match(await b.evaluate("document.querySelector('.tabs-body').textContent"),/客户已有保障/);
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.insurance-workspace-links a')].map(x=>x.getAttribute('href'))"),['#/person/980001/care','#/person/980001/ocr']);
  await b.evaluate("document.querySelector('.insurance-workspace-links a').click()");
  await b.wait("document.querySelector('.care-workspace-links')");
  assert.equal(await b.evaluate('location.hash'),'#/person/980001/care');
  assert.ok((await b.evaluate('window.m04Reads')).every(x=>x.id===71));
  await b.evaluate("document.querySelector('.care-workspace-links a:last-child').click()");
  await b.wait("document.querySelector('.ocr-workspace-links')");
  assert.equal(await b.evaluate('location.hash'),'#/person/980001/ocr');
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.ocr-workspace-links a')].map(x=>x.getAttribute('href'))"),['#/person/980001/care','#/person/980001/insurance']);
  const reads=await b.evaluate('window.m04Reads.length');
  await b.evaluate("window.m04Data.customerProfile=async()=>({status:'unlinked'});location.hash='#/person/980001/care'");
  await b.wait("location.hash.endsWith('/care') && document.querySelector('.tabs .tab.active')");
  await b.wait("document.querySelector('.tabs-body').textContent.includes('客户')");
  assert.equal(await b.evaluate("document.querySelector('.care-workspace-links')"),null);
  assert.equal(await b.evaluate('window.m04Reads.length'),reads);
  await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');location.hash='#/person/980001/insurance'})()`);
  await b.wait("document.querySelector('.insurance-workspace-links')");
  assert.match(await b.evaluate("document.querySelector('.tabs-body').textContent"),/existing coverage/);
  assert.equal(await b.evaluate(`import('/crm/js/modules/console/i18n.js').then(m=>m.t('legacy_products'))`),'Customer Coverage');
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['create','update','execute','remove'].includes(c.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
