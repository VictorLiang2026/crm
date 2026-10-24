'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M14 knowledge keeps review states separate from validity, source types and objection hypotheses',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  const dates=await b.evaluate(`(async()=>{
   const {renderKnowledgeGovernance,knowledgeValidity}=await import('/crm/js/modules/console/knowledge-governance.js');
   window.m14={calls:[],records:{knowledge:[
    {id:1,item_type:'evidence',source:'[CRM_TEST_ONLY] Fictional clause',source_date:'2026-01-01',content:'[CRM_TEST_ONLY] Old clause',lifecycle_status:'verified',verified:true,valid_from:'2000-01-01',valid_to:'2000-12-31',version_no:3,confidence:.9},
    {id:2,item_type:'case',source:'[CRM_TEST_ONLY] Fictional case',content:'[CRM_TEST_ONLY] A case',lifecycle_status:'draft',valid_from:'2099-01-01'},
    {id:3,item_type:'story',source:'[CRM_TEST_ONLY] Fictional story',content:'[CRM_TEST_ONLY] A story',lifecycle_status:'superseded'}],
    playbooks:[{id:4,scenario:'[CRM_TEST_ONLY] Fictional objection',objection:'Need more time',response_logic:'Ask a clarifying question',
     lifecycle_status:'verified',source:'[CRM_TEST_ONLY] Fictional review',possible_underlying_reasons:['[CRM_TEST_ONLY] Might need clarification'],
     evidence_refs:[1],case_refs:[2],story_refs:[3]}]}};
   window.m14Render=async lang=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(lang);
    renderKnowledgeGovernance({main:document.querySelector('.console-main'),api:{call:async(n,p)=>{m14.calls.push({n,p});if(p.action==='listKnowledgeGovernance')return m14.records;throw Error('unexpected write');}}});};
   await m14Render('zh-CN');
   const now=new Date('2026-10-23T16:30:00Z');
   return [knowledgeValidity({valid_to:'2026-10-23'},now),knowledgeValidity({valid_from:'2026-10-24',valid_to:'2026-10-24'},now),
    knowledgeValidity({valid_from:'2026-10-25'},now),knowledgeValidity({},now),knowledgeValidity({valid_from:'2026-02-30'},now),
    knowledgeValidity({valid_from:'2026-10-25',valid_to:'2026-10-24'},now)];
  })()`);
  assert.deepEqual(dates,['expired','within','future','unspecified','invalid','invalid']);
  await b.wait("document.querySelectorAll('.kg-row').length===4");
  const clause=await b.evaluate("document.querySelector('[data-kg-id=\"1\"]').innerText");
  assert.match(clause,/已审核/);assert.match(clause,/已过有效期/);assert.match(clause,/版本: 3/);assert.match(clause,/2026-01-01/);
  assert.match(await b.evaluate("document.querySelector('[data-kg-id=\"2\"]').innerText"),/待审核[\s\S]*尚未到生效/);
  assert.match(await b.evaluate("document.querySelector('[data-kg-id=\"3\"]').innerText"),/故事用于辅助沟通/);
  await b.evaluate("document.querySelector('[data-kg-id=\"4\"] details').open=true");
  assert.match(await b.evaluate("document.querySelector('[data-kg-id=\"4\"]').innerText"),/可能的解释|可能的异议原因/);
  assert.match(await b.evaluate("document.querySelector('[data-kg-id=\"4\"]').innerText"),/Might need clarification/);
  assert.equal(await b.evaluate("m14.calls.every(x=>x.p.action==='listKnowledgeGovernance')"),true);
  assert.equal(await b.evaluate("m14.records.knowledge[0].lifecycle_status"),'verified');
  for(const lang of ['en','zh-CN']){
   await b.evaluate('m14Render('+JSON.stringify(lang)+')');await b.wait("document.querySelectorAll('.kg-row').length===4");
   assert.match(await b.evaluate("document.querySelector('.console-main').innerText"),lang==='en'?/loaded items only/:/已加载的内容/);
   for(const [width,height]of [[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,lang+' '+width);
   }
  }
  await b.healthy();
 }finally{await b.close();}
});
