'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('customer Opportunity maintenance requires server preview and human confirmation',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();
    await browser.openConsole('#/opportunities','authCase=1');
    await browser.evaluate(`(async()=>{
      const {openLegacyOpportunityMaintenance}=await import('/crm/js/modules/console/legacy-opportunity-maintenance.js');
      window.maintenanceCalls=[];
      const ctx={api:{call:async(name,payload)=>{
        window.maintenanceCalls.push({name,action:payload.action});
        if(payload.action==='previewLegacyOpportunityMaintenance')return {
          previewId:'11111111-1111-4111-8111-111111111111',status:'preview',
          preview:{operation:'remove',customerId:12,opportunityId:34,linkedActionCount:2,outcomeCount:1,
            before:{},after:{}}};
        if(payload.action==='executeLegacyOpportunityMaintenance')return {
          operation:'remove',customerId:12,opportunityId:34};
        if(payload.action==='getOpportunityDirectoryDetails')throw Error('Opportunity unavailable');
        throw Error('Unexpected action');
      }},toast:()=>{}};
      openLegacyOpportunityMaintenance(ctx,{opportunity:{id:34,customer_id:12,status:'关闭'},mode:'remove'});
    })()`);
    await browser.wait("document.querySelector('.legacy-opportunity-form')");
    assert.deepEqual(await browser.evaluate('window.maintenanceCalls'),[]);
    await browser.click('.legacy-opportunity-form button','生成服务端预览');
    await browser.wait("document.querySelector('.legacy-opportunity-preview')?.innerText.includes('关联 Action 2')");
    assert.deepEqual(await browser.evaluate('window.maintenanceCalls.map(x=>x.action)'),
      ['previewLegacyOpportunityMaintenance']);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.legacy-opportunity-preview button')].find(x=>x.textContent.includes('确认软删除')).disabled"),true);
    await browser.evaluate("document.querySelector('.legacy-opportunity-preview input[type=checkbox]').click()");
    await browser.click('.legacy-opportunity-preview button','确认软删除');
    await browser.wait("document.querySelector('.legacy-opportunity-receipt')?.innerText.includes('已软删除')");
    assert.deepEqual(await browser.evaluate('window.maintenanceCalls.map(x=>x.action)'),
      ['previewLegacyOpportunityMaintenance','executeLegacyOpportunityMaintenance','getOpportunityDirectoryDetails']);
    await browser.evaluate("localStorage.setItem('crm_lang','en')");
    await browser.openConsole('#/opportunities','authCase=1');
    await browser.evaluate(`(async()=>{
      const {openLegacyOpportunityMaintenance}=await import('/crm/js/modules/console/legacy-opportunity-maintenance.js');
      openLegacyOpportunityMaintenance({api:{call:async()=>({})},toast:()=>{}},
        {opportunity:{id:34,customer_id:12,status:'成交'},mode:'terminal_edit'});
    })()`);
    await browser.wait("document.querySelector('.legacy-opportunity-form')");
    assert.match(await browser.evaluate("document.querySelector('.legacy-opportunity-form').innerText"),/Correct fields/);
    await browser.healthy();
  }finally{await browser.close();}
});

test('identity exceptions show source IDs without selecting a Person or writing',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();
    await browser.openConsole('#/opportunities','authCase=1');
    await browser.evaluate(`(async()=>{
      const {openIdentityExceptions}=await import('/crm/js/modules/console/pages/opportunities.js');
      window.identityCalls=[];
      openIdentityExceptions({api:{call:async(name,payload)=>{
        window.identityCalls.push({name,action:payload.action});
        return {total:1,rows:[{opportunityId:34,customerId:12,opportunityPersonId:null,
          customerPersonId:56,customerPersonName:'虚构人物',status:'发现',reason:'opportunity_person_missing'}]};
      }}});
    })()`);
    await browser.wait("document.querySelector('.opp-history-row')?.innerText.includes('#34')");
    assert.match(await browser.evaluate("document.querySelector('.opp-history-row').innerText"),/客户 #12/);
    assert.deepEqual(await browser.evaluate('window.identityCalls'),[
      {name:'person_360',action:'listLegacyOpportunityIdentityExceptions'}]);
    await browser.healthy();
  }finally{await browser.close();}
});
