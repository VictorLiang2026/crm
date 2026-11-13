'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('master record, page coverage and old alias search on desktop, tablet and phone',async()=>{
 const browser=new Browser(path.resolve(__dirname,'../..'));
 try{
  await browser.start();await browser.openConsole('#/more','authCase=1');await browser.wait("document.querySelector('.console-main')");
  for(const [width,lang] of [[1440,'en'],[820,'zh-CN'],[390,'zh-CN']]){
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});
   await browser.evaluate(`(async()=>{
    const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
    (await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');
    let main=document.getElementById('document-fixture');if(!main){main=document.createElement('main');main.id='document-fixture';document.body.appendChild(main);}
    const rows=[1,2,3].map((part,i)=>({id:14+i,source_id:35+i,source:'Volume '+part,lifecycle_status:part===2?'draft':'verified',
     metadata:{document:{number:100001,part,total:3,start:1+30*i,end:Math.min(30*part,85),pages:85,title:'Fixture'}}}));
    renderKnowledgeGovernance({main,toast:()=>{},api:{call:async(_,p)=>p.operation==='list'?{ok:true,knowledge:rows}:
      {parts:[{part:1,start:1,end:30,summary:'Reviewed first'},{part:3,start:61,end:85,summary:'Reviewed last'}],total:3,pages:85}}});
   })()`);
   await browser.wait("document.querySelector('[data-document-number] button')");
   assert.equal(await browser.evaluate("document.querySelectorAll('tbody tr').length"),1);
   await browser.evaluate("document.querySelector('[type=search]').value='S-36';document.querySelector('.kg-search').requestSubmit();document.querySelector('[data-document-number] button').click()");
   await browser.wait("document.querySelector('.kg-document-overview')?.textContent.includes('Reviewed last')");
   assert.deepEqual(await browser.evaluate("Array.from(document.querySelectorAll('[data-kg-id] .kg-number-cell'),e=>e.textContent)"),['100001-01','100001-02','100001-03']);
   assert.match(await browser.evaluate("document.querySelector('.kg-document-overview').innerText"),/1–30, 61–85/);
  }
  await browser.healthy();
 }finally{await browser.close();}
});
