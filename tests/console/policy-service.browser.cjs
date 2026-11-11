'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('policy actions, report confirmation, opportunity references and customer filters across layouts',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try {
    await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
    await b.evaluate(`(async()=>{
      const ui=await import('/crm/js/modules/console/policy-service.js');
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const main=document.querySelector('.console-main');
      const report={id:12,customer_id:2,review_revision:0,report_date:'2026-11-11',summary:'Fixture report'};
      const state={...report,is_valid:true,is_current:false,product_basis:'30:2'};
      const calls=[],actions=[];let linked=false;
      const ctx={main,toast(){},api:{async call(n,a){
        calls.push(a);if(a.action==='listPeople')return {rows:[],page:1,total:0,totalPages:1};
        if(a.action!=='policyService')throw Error(a.action);
        switch(a.operation){
          case 'state':return {...state};
          case 'approve':state.is_current=true;return {ok:true};
          case 'scheduleList':return {rows:actions.slice()};
          case 'schedule':return {previewId:'receipt42',kind:a.data.kind,day:a.data.day,preview:{personName:'Fixture Person',after:{title:a.data.title}}};
          case 'confirmSchedule':if(a.data.previewId!=='receipt42')throw Error('Unexpected receipt');actions.push({id:42,title:'Test renewal',due_at:'2027-01-01T04:00:00Z',service_kind:'renewal'});return {itemId:42};
          case 'options':return {rows:[{id:12,revision:0,basis:'30:2',date:report.report_date,summary:report.summary,current:true,linked}]};
          case 'link':linked=true;return {ok:true};
        }
        throw Error(a.operation);
      }}};
      const draw=()=>main.replaceChildren(ui.reviewControls(ctx,report,draw),ui.policySchedules(ctx,2),ui.opportunityReports(ctx,6));
      window.p6={draw,calls,actions,lang:setLang,people:()=>renderPeople(ctx)};draw();
    })()`);
    await b.wait("document.querySelector('.policy-governance button')");
    await b.click('.policy-governance button','审核摘要');await b.wait("document.querySelector('.sheet .btn-primary')");
    assert.ok(!(await b.evaluate("p6.calls.some(c=>c.operation==='approve')")));
    await b.click('.sheet .btn-primary','');await b.wait("document.querySelector('.policy-governance').textContent.includes('已审核，可作当前依据')");
    await b.evaluate("document.querySelector('.policy-schedules select').value='renewal';document.querySelector('.policy-schedules input[type=date]').value='2027-01-01';document.querySelector('.policy-schedules input[type=text]').value='Test renewal';document.querySelector('.policy-schedules button').click()");
    await b.wait("document.querySelector('.sheet .btn-primary')");assert.equal(await b.evaluate("p6.actions.length"),0);
    await b.click('.sheet .btn-primary','');await b.wait("document.querySelector('.policy-schedules a[href=\"#/actions/42\"]')");
    await b.click('.policy-opportunity-reports button','引用摘要');await b.wait("document.querySelector('.sheet .btn-primary')");
    await b.click('.sheet .btn-primary','');await b.wait("document.querySelector('.policy-opportunity-reports').textContent.includes('已引用')");
    for(const lang of ['zh-CN','en']){
      await b.evaluate(`p6.lang('${lang}');p6.draw()`);await b.wait("document.querySelector('.policy-governance button')");
      for(const [width,height] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
        assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),lang+' '+width);
      }
    }
    await b.evaluate("p6.people()");await b.wait("document.querySelector('[data-directory-view=customer]')");
    await b.evaluate("document.querySelector('[data-directory-view=customer]').click()");
    for(const key of ['review','renewal','verify']){
      await b.evaluate(`(()=>{const e=[...document.querySelectorAll('.console-main select')].find(x=>x.querySelector('option[value=renewal]'));e.value='${key}';e.dispatchEvent(new Event('change'))})()`);
      await b.wait(`p6.calls.some(c=>c.action==='listPeople'&&c.customerWorklist&&c.policyFilter==='${key}')`);
    }
    await b.healthy();
  }finally{await b.close();}
});
