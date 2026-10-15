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
