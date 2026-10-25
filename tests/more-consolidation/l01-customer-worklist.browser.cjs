'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
for(const lang of ['zh-CN','en'])test(`L01 customer status, paging, retry and same-Person links (${lang})`,async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');
  await b.evaluate(`(async()=>{
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});
   const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
   window.l01Requests=[];window.l01Fail=false;
   window.l01Render=()=>renderPeople({main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
    window.l01Requests.push(args);if(window.l01Fail){window.l01Fail=false;throw Error('Fixture retry');}
    return {rows:[{id:990001,display_name:'Fixture One',roles:['customer','recruit'],customer_stage:'关系维护',
     sales_priority:'A',recruit_id:990002,recruit_status:'active',recruit_stage:'初次面谈',wb_status:'overdue',
     latest_followup_date:'2026-10-01',next_followup_date:'2026-10-20'},
     {id:990003,display_name:'Fixture Two',roles:['customer'],wb_status:'unknown',recruit_status:'historical'}],
     page:args.page,pageSize:args.pageSize,total:61,totalPages:3,hasMore:args.page<3};
   }}});window.l01Render();
   document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>');
  })()`);
  await b.wait("document.querySelector('.people-table tbody')");
  await b.evaluate("document.querySelector('.toolbar button[aria-pressed]').click()");
  await b.wait("document.querySelector('.people-col-wb_status')");
  assert.equal(await b.evaluate('window.l01Requests.at(-1).customerWorklist'),true);
  assert.equal(await b.evaluate('window.l01Requests.at(-1).sortField'),'wb_status');
  assert.equal(await b.evaluate("document.querySelector('.people-col-recruit_status a').getAttribute('href')"),'#/person/990001/recruit');
  assert.equal(await b.evaluate("document.querySelector('.people-col-next_followup a').getAttribute('href')"),'#/person/990001/timeline');
  assert.ok((await b.evaluate("document.querySelector('tbody').innerText")).includes(lang==='en'?'Past recruit':'曾经招募'));
  await b.evaluate("(()=>{const e=document.querySelector('.toolbar select');e.value='overdue';e.dispatchEvent(new Event('change'));})()");
  await b.wait("window.l01Requests.at(-1).worklistStatus==='overdue' && document.querySelector('tbody')");
  await b.evaluate("document.querySelector('.pager button:last-child').click()");
  await b.wait("window.l01Requests.at(-1).page===2 && document.querySelector('tbody')");
  assert.equal(await b.evaluate('window.l01Requests.at(-1).worklistStatus'),'overdue');
  await b.evaluate("window.l01Fail=true;document.querySelector('th.people-col-wb_status').click()");
  await b.wait("document.body.innerText.includes('Fixture retry')");
  await b.evaluate("document.querySelector('.card-body button, .error-box button').click()");
  await b.wait("document.querySelector('tbody')");
  for(const [width,height] of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const shot=await b.send('Page.captureScreenshot',{format:'png'});
  const dir=path.resolve(__dirname,'../security/.results');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,`l01-${lang}.png`),Buffer.from(shot.data,'base64'));
  await b.evaluate("document.querySelector('.toolbar button[aria-pressed]').click()");
  await b.wait("window.l01Requests.at(-1).customerWorklist===false && document.querySelector('tbody')");
  assert.equal(await b.evaluate('window.l01Requests.at(-1).sortField'),'id');
  assert.equal(await b.evaluate("document.querySelector('.people-col-wb_status')"),null);
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
