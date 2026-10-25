'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
for(const lang of ['zh-CN','en'])test('L04b explicit identity, unchecked fields, server preview and retry '+lang,async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');
  await b.wait("document.querySelector('#console-main .more-section')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   (await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');
   window.fileCase={calls:[],fail:true,job:{id:'11111111-1111-4111-8111-111111111111',file_name:'fictional.txt',status:'draft',
    person_id:null,apply_command_id:null,parsed_fields:{customer_name:'Fictional',phone:'123',additional_info:'reviewed note'},raw_text:'fictional text'}};
   data.personFile=async()=>({job:{...fileCase.job},source:{photo_url:'data:text/plain;base64,dGVzdA==',file_name:'fictional.txt'}});
   data.resolvePersonName=async()=>{fileCase.calls.push({type:'resolve'});return{displayName:'Fictional',status:'confirm_existing',hasMore:false,deletedIdentity:false,candidates:[{id:12,displayName:'Fictional',occupation:'test'}]};};
   data.previewPersonFile=async(ctx,p)=>{fileCase.calls.push({type:'preview',payload:p});return{previewId:'33333333-3333-4333-8333-333333333333',expiresAt:'2026-10-25T14:00:00Z',preview:{displayName:'Fictional',personId:12,fileName:'fictional.txt',operation:'apply',before:{phone:'old'},after:p.fields}};};
   data.executePersonFile=async(ctx,id)=>{fileCase.calls.push({type:'execute',id});if(fileCase.fail){fileCase.fail=false;throw Error('uncertain');}return{ok:true,personId:12,operation:'apply'};};
   const host=document.createElement('div');document.getElementById('console-main').replaceChildren(host);
   await (await import('/crm/js/modules/console/person-files.js')).reviewPersonFile({},fileCase.job,host);
  })()`);
  assert.equal(await b.evaluate("document.querySelectorAll('.l04-fields input:checked').length"),0);
  assert.equal(await b.evaluate("document.querySelector('.l04-file-form > button:last-child').disabled"),true);
  await b.click('.l04-file-form > button',lang==='en'?'Check Name':'检查同名');
  await b.wait("document.querySelectorAll('.l04-identity-choice').length===1");
  assert.equal(await b.evaluate("document.querySelector('.l04-file-form > button:last-child').disabled"),true);
  await b.click('.l04-identity-choice','Fictional');
  for(const [width,height]of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync('tests/security/.results',{recursive:true});
  fs.writeFileSync(`tests/security/.results/l04b-${lang}.png`,Buffer.from(shot.data,'base64'));
  await b.evaluate("document.querySelector('[data-field=phone]').checked=true");
  await b.click('.l04-file-form > button',lang==='en'?'Preview Link & Field Changes':'预览关联与资料应用');
  await b.wait("document.querySelector('.l04-preview').textContent.includes('123')");
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.l04-file-form')).display"),'none');
  assert.deepEqual(await b.evaluate("fileCase.calls.find(x=>x.type==='preview').payload.fields"),{phone:'123'});
  assert.equal(await b.evaluate("fileCase.calls.filter(x=>x.type==='execute').length"),0);
  const confirm=await b.evaluate("(async()=> (await import('/crm/js/modules/console/i18n.js')).t('btn_confirm'))()");
  await b.click('.l04-preview button',confirm);
  await b.wait("fileCase.calls.filter(x=>x.type==='execute').length===1&&!document.querySelector('.l04-preview button:last-child').disabled");
  assert.match(await b.evaluate("document.querySelector('.sheet-err').textContent"),lang==='en'?/unconfirmed/:/未获确认/);
  await b.click('.l04-preview button',confirm);
  await b.wait("fileCase.calls.filter(x=>x.type==='execute').length===2&&document.querySelector('a[href=\"#/person/12/ocr\"]')");
  assert.equal(await b.evaluate("fileCase.calls.filter(x=>x.type==='execute')[0].id===fileCase.calls.filter(x=>x.type==='execute')[1].id"),true);
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   fileCase.job.person_id=12;fileCase.job.apply_command_id='33333333-3333-4333-8333-333333333333';
   data.personFile=async()=>({job:{...fileCase.job},source:{photo_url:'data:text/plain;base64,dGVzdA==',file_name:'fictional.txt'},commands:[{operation:'apply',status:'executed',executed_at:'2026-10-25T13:00:00Z',preview:{displayName:'Fictional',before:{phone:'old'},after:{phone:'123'}}}]});
   data.previewPersonFileUndo=async(ctx,p)=>{fileCase.calls.push({type:'undo-preview',p});return{previewId:'44444444-4444-4444-8444-444444444444',preview:{operation:'undo',personId:12,displayName:'Fictional',before:{phone:'123'},after:{phone:'old'},fileName:'fictional.txt'}};};
   data.executePersonFile=async(ctx,id)=>{fileCase.calls.push({type:'undo-execute',id});return{ok:true,operation:'undo',personId:12};};
   const host=document.createElement('div');document.getElementById('console-main').replaceChildren(host);
   await (await import('/crm/js/modules/console/person-files.js')).reviewPersonFile({},fileCase.job,host);
  })()`);
  assert.match(await b.evaluate("document.querySelector('.l04-command-history').textContent"),/old → 123/);
  await b.click('.l04-file-form button',lang==='en'?'Preview Undo':'预览撤销');
  await b.wait("document.querySelector('.l04-preview').textContent.includes('old')");
  assert.equal(await b.evaluate("fileCase.calls.filter(x=>x.type==='undo-execute').length"),0);
  await b.click('.l04-preview button',confirm);
  await b.wait("fileCase.calls.filter(x=>x.type==='undo-execute').length===1&&document.querySelector('a[href=\"#/person/12/ocr\"]')");
  for(const [width,height]of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  await b.healthy();
 }finally{await b.close();}
});
test('L04b standalone upload uses its own endpoints and new Person remains an explicit choice',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('#console-main .more-section')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');(await import('/crm/js/modules/console/i18n.js')).setLang('en');
   window.standaloneCase={calls:[],jobs:[]};
   data.personFiles=async()=>({rows:standaloneCase.jobs,hasMore:false});
   data.savePersonFileOriginal=async(ctx,p)=>{standaloneCase.calls.push({type:'save',p});const job={id:p.idempotencyKey,file_name:p.fileName,content_type:p.contentType,status:'saved'};standaloneCase.jobs.push(job);return{job};};
   data.parsePersonFileDraft=async(ctx,id)=>{standaloneCase.calls.push({type:'parse'});const job=standaloneCase.jobs[0];Object.assign(job,{status:'draft',person_id:null,parsed_fields:{customer_name:'New Fictional'},raw_text:'fictional'});return{job};};
   data.personFile=async()=>({job:standaloneCase.jobs[0],commands:[],source:{photo_url:'data:text/plain;base64,dGVzdA==',file_name:'fictional.txt'}});
   data.resolvePersonName=async()=>({displayName:'New Fictional',status:'available',candidates:[],hasMore:false,deletedIdentity:false});
   data.previewPersonFile=async(ctx,p)=>{standaloneCase.calls.push({type:'preview',p});return{previewId:'33333333-3333-4333-8333-333333333333',expiresAt:'2026-10-25T14:00:00Z',preview:{operation:'apply',displayName:'New Fictional',newPerson:true,fileName:'fictional.txt',before:{},after:{}}};};
   data.executePersonFile=async()=>{throw Error('must not execute without confirmation');};
   location.hash='#/people/import';
  })()`);
  await b.wait("document.querySelector('.file-import input[type=file]')&&!document.querySelector('.file-import input[type=file]').disabled");
  assert.equal(await b.evaluate("document.querySelector('.page-title').textContent"),'Import Person from File');
  assert.match(await b.evaluate("document.querySelector('.page-sub').textContent"),/Save and parse/);
  await b.evaluate(`(()=>{const input=document.querySelector('.file-import input[type=file]');Object.defineProperty(input,'files',{value:[new File(['test'],'fictional.txt',{type:'text/plain'})]});input.dispatchEvent(new Event('change'));})()`);
  await b.click('.file-import > .care-record-actions button','Save All & Parse Supported Files');
  await b.wait("standaloneCase.calls.length===2&&!document.querySelector('.file-import input[type=file]').disabled");
  const saved=await b.evaluate('standaloneCase.calls[0].p');assert.equal('personId' in saved,false);assert.equal('customerId' in saved,false);
  await b.click('.file-import-item button','Review Saved Draft');await b.wait("document.querySelector('.l04-file-form')");
  await b.click('.l04-file-form > button','Check Name');await b.wait("document.querySelector('.l04-identity-choice')");
  assert.equal(await b.evaluate("document.querySelector('.l04-file-form > button:last-child').disabled"),true);
  await b.click('.l04-identity-choice','Choose New Person');await b.click('.l04-file-form > button','Preview Link & Field Changes');
  await b.wait("document.querySelector('.l04-preview').textContent.includes('New Fictional')");
  const payload=await b.evaluate("standaloneCase.calls.find(x=>x.type==='preview').p");assert.equal('personId' in payload,false);assert.deepEqual(payload.fields,{});
  await b.click('.l04-preview button','Cancel');assert.equal(await b.evaluate("document.querySelector('.l04-file-form').hidden"),false);
  await b.healthy();
 }finally{await b.close();}
});

