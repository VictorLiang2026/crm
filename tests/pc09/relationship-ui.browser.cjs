'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('relationship UI requires resolved identity and human confirmation at iPad sizes',async()=>{
 const browser=new Browser(path.resolve(__dirname,'../..'));
 try{
  await browser.start(); await browser.open('#/more');
  await browser.evaluate(`(async()=>{
   const {relationshipNode}=await import('/crm/js/modules/console/relationship-actions.js');
   const i18n=await import('/crm/js/modules/console/i18n.js');window.pc09I18n=i18n;
   window.pc09Calls=[];window.pc09Execute=[];window.pc09Confirm=false;
   window.confirm=()=>window.pc09Confirm;
   const ctx={onWriteDone(){window.pc09Reload=(window.pc09Reload||0)+1},api:{call:async(name,args)=>{
    window.pc09Calls.push({name,...args});
    if(args.action==='listRelationships')return{rows:[]};
    if(args.action==='resolveRelationshipName')return{candidates:[{id:'72',displayName:'【系统测试·勿联系】对端'}]};
    if(args.action==='previewRelationship')return{previewId:'c13ea68b-5a87-4554-88bd-82b29f37ec37',preview:{before:{},after:{status:'pending',relationshipType:args.data.relationshipType}}};
    if(args.action==='executeRelationship'){window.pc09Execute.push(args);return{ok:true};}
    throw Error('Unexpected PC09 action '+args.action);
   }}};
   document.getElementById('view').replaceChildren(await relationshipNode(ctx,'71'));
  })()`);
  await browser.wait("document.querySelector('.tab-stack button')?.textContent.includes('新增关系')");
  assert.equal(await browser.evaluate("document.querySelector('.tab-stack').innerText.includes('暂无人际关系记录')"),true);
  for(const [width,height] of [[820,1180],[1180,820]]){
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
  }
  await browser.evaluate(`(()=>{window.pc09I18n.setLang('en');window.pc09English={tab:window.pc09I18n.t('tab_relationships'),pending:window.pc09I18n.t('relationship_pending')};window.pc09I18n.setLang('zh-CN')})()`);
  assert.deepEqual(await browser.evaluate('window.pc09English'),{tab:'Relationships',pending:'Pending'});
  await browser.evaluate(`(()=>{document.querySelector('.tab-stack button').click();const inputs=[...document.querySelectorAll('.person-relationship-editor input')];inputs[0].value='【系统测试·勿联系】对端';[...document.querySelectorAll('.person-relationship-editor button')].find(x=>x.textContent.includes('核对人物身份')).click()})()`);
  await browser.wait("document.querySelectorAll('.person-relationship-editor button').length>=3");
  await browser.evaluate(`(()=>[...document.querySelectorAll('.person-relationship-editor button')].find(x=>x.textContent.includes('对端')).click())()`);
  await browser.wait("window.pc09Calls.some(x=>x.action==='previewRelationship')");
  assert.equal(await browser.evaluate('window.pc09Execute.length'),0,'cancelled human confirmation must not execute');
  await browser.evaluate('window.pc09Confirm=true');
  await browser.evaluate(`(()=>[...document.querySelectorAll('.person-relationship-editor button')].find(x=>x.textContent.includes('对端')).click())()`);
  await browser.wait('window.pc09Execute.length===1');
  assert.equal(await browser.evaluate("window.pc09Calls.filter(x=>x.action==='previewRelationship').length"),2);
  assert.equal(await browser.evaluate('window.pc09Reload'),1);
 }finally{await browser.close();}
});

async function setupLifecycleFixture(){
 const {relationshipNode}=await import('/crm/js/modules/console/relationship-actions.js');
 const i18n=await import('/crm/js/modules/console/i18n.js');
 i18n.setLang('zh-CN');
 window.pc09State={id:8,from_person_id:71,to_person_id:72,other_name:'【系统测试·勿联系】对端',
  direction:'outgoing',relationship_type:'friend',relationship_stage:'【系统测试·勿联系】关系',
  strength:null,trust_level:null,trend:null,importance:2,source:'manual',status:'confirmed',
  confirmed_at:'2026-10-19T10:00:00Z',deleted_at:null};
 window.pc09Prompts=[];window.pc09Alerts=[];window.pc09Exec=[];window.pc09Confirm=false;
 window.pc09BadPreview=false;window.pc09PreviewCount=0;window.pc09Pending=new Map();
 window.confirm=message=>{window.pc09Prompts.push(message);return window.pc09Confirm;};
 window.alert=message=>window.pc09Alerts.push(message);
 window.pc09Ctx={onWriteDone(){},api:{call:async(name,args)=>{
  if(name!=='person_360')throw Error('Unexpected function');
  if(args.action==='listRelationships')return {rows:window.pc09State.deleted_at&&!args.includeDeleted?[]:[window.pc09State]};
  if(args.action==='previewRelationship'){
   const operation=args.operation, row=window.pc09State;
   const before={relationshipId:row.id,fromPersonId:row.from_person_id,toPersonId:row.to_person_id,
    relationshipType:row.relationship_type,relationshipStage:row.relationship_stage,strength:row.strength,
    trustLevel:row.trust_level,trend:row.trend,importance:row.importance,source:row.source,
    status:row.status,deletedAt:row.deleted_at};
   const after={fromPersonId:row.from_person_id,toPersonId:row.to_person_id,
    relationshipType:row.relationship_type,relationshipStage:row.relationship_stage,strength:row.strength,
    trustLevel:row.trust_level,trend:row.trend,importance:row.importance,source:row.source,
    status:row.status,deleted:operation==='unlink'};
   if(window.pc09BadPreview)after.toPersonId=999;
   const previewId='c13ea68b-5a87-4554-88bd-'+String(++window.pc09PreviewCount).padStart(12,'0');
   window.pc09Pending.set(previewId,operation);
   return {previewId,preview:{personId:71,fromPersonId:71,toPersonId:72,
    fromPersonName:'【系统测试·勿联系】当前人物',toPersonName:'【系统测试·勿联系】对端',
    humanConfirmationRequired:true,before,after}};
  }
  if(args.action==='executeRelationship'){
   const operation=window.pc09Pending.get(args.previewId);
   if(!operation)throw Error('Preview not found');
   if(!window.pc09Exec.includes(args.previewId)){
    window.pc09Exec.push(args.previewId);
    window.pc09State.deleted_at=operation==='unlink'?'2026-10-19T11:00:00Z':null;
   }
   return {ok:true,replayed:window.pc09Exec.filter(id=>id===args.previewId).length>1};
  }
  throw Error('Unexpected action '+args.action);
 }}};
 window.pc09Mount=async()=>document.querySelector('.console-main').replaceChildren(
  await relationshipNode(window.pc09Ctx,'71'));
 await window.pc09Mount();
}

test('relationship unlink and restore show bilingual reviewed scope without raw JSON or unconfirmed writes',async()=>{
 const browser=new Browser(path.resolve(__dirname,'../..'));
 try{
  await browser.start();await browser.openConsole('#/more');
  await browser.wait("document.querySelector('.console-main')");
  await browser.evaluate('('+setupLifecycleFixture.toString()+')()');
  await browser.wait("[...document.querySelectorAll('.tab-stack button')].some(x=>x.textContent.trim()==='解除关系')");
  for(const [width,height] of [[820,1180],[1180,820]]){
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const clickUnlink="(()=>[...document.querySelectorAll('.tab-stack button')].find(x=>x.textContent.trim()==='解除关系').click())()";
  await browser.evaluate(clickUnlink);
  await browser.wait('window.pc09Prompts.length===1');
  const zh=await browser.evaluate('window.pc09Prompts[0]');
  for(const value of ['关系 #8','Person #71','Person #72','变更前','已确认 · 当前有效',
   '变更后','已确认 · 已解除','人物、家庭、其他关系与机会保留','关系网络、转介绍路径和会前 AI 上下文'])
   assert.ok(zh.includes(value),value);
  assert.ok(!zh.includes('{"relationshipId"')&&!zh.includes('"deleted"'));
  assert.equal(await browser.evaluate('window.pc09Exec.length'),0);
  await browser.evaluate('window.pc09BadPreview=true');
  await browser.evaluate(clickUnlink);
  await browser.wait('window.pc09Alerts.length===1');
  assert.equal(await browser.evaluate('window.pc09Prompts.length'),1,'mismatched server preview is not confirmable');
  assert.equal(await browser.evaluate('window.pc09Exec.length'),0);
  await browser.evaluate('window.pc09BadPreview=false;window.pc09Confirm=true');
  await browser.evaluate(clickUnlink);
  await browser.wait('window.pc09Exec.length===1');
  assert.equal(await browser.evaluate('Boolean(window.pc09State.deleted_at)'),true);
  await browser.evaluate("window.pc09Ctx.api.call('person_360',{action:'executeRelationship',previewId:window.pc09Exec[0]})");
  assert.equal(await browser.evaluate('window.pc09Exec.length'),1,'same preview replay has no second business write');
  await browser.evaluate("(async()=>{window.pc09I18n=await import('/crm/js/modules/console/i18n.js');window.pc09I18n.setLang('en');window.pc09Confirm=false;await window.pc09Mount();document.querySelector('.people-filter-check input').click()})()");
  await browser.wait("[...document.querySelectorAll('.tab-stack button')].some(x=>x.textContent.trim()==='Restore')");
  const clickRestore="(()=>[...document.querySelectorAll('.tab-stack button')].find(x=>x.textContent.trim()==='Restore').click())()";
  await browser.evaluate(clickRestore);
  await browser.wait('window.pc09Prompts.length===3');
  const en=await browser.evaluate('window.pc09Prompts[2]');
  for(const value of ['Relationship #8','From Person','To Person','Before: Confirmed · Unlinked',
   'After: Confirmed · Active','Only this relationship is restored','People, households, other relationships and opportunities remain'])
   assert.ok(en.includes(value),value);
  assert.ok(!en.includes('{"relationshipId"')&&!en.includes('"deleted"'));
  assert.equal(await browser.evaluate('window.pc09Exec.length'),1);
  await browser.evaluate('window.pc09Confirm=true');
  await browser.evaluate(clickRestore);
  await browser.wait('window.pc09Exec.length===2');
  assert.equal(await browser.evaluate('window.pc09State.deleted_at'),null);
  await browser.healthy();
 }finally{await browser.close();}
});
