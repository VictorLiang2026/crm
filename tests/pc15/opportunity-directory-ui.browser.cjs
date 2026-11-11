'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('WP3 pipeline lists, paging, identity filter, detail preview and responsive layout',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();
    await browser.open('#/ai');
    await browser.evaluate(`(async()=>{
      const {renderOpportunities}=await import('/crm/js/modules/console/pages/opportunities.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');window.pc15I18n=i18n;
      const person={id:71,display_name:'【系统测试·勿联系】虚构机会甲'};
      const open={id:91,person_id:71,customer_id:null,opportunity_type:'insurance',status:'发现',person,
        last_progress:'【系统测试·勿联系】虚构进展',next_action:'【系统测试·勿联系】核对虚构资料',next_action_date:'2026-10-20'};
      const legacy={id:92,person_id:71,customer_id:301,opportunity_type:'医疗保障',status:'关闭',person};
      window.pc15={calls:[],executions:[],directoryResult:{rows:[open],page:1,pageSize:20,total:2,hasMore:true,countsByStatus:{'发现':3,'成交':1,'关闭':1}},
        async call(name,args){this.calls.push({name,args});
          if(name==='person_360'&&args.action==='listPendingOpportunityCandidates')return {rows:[]};
          if(name==='person_360'&&args.action==='getPipelineState')return {stage:'需求线索'};
          if(name==='person_360'&&args.action==='listOpportunityDirectory'){
            const row=args.kind==='recruitment' ? {id:92,entity:'candidate',track:'recruitment',raw_stage:'互动暖客',record_type:'recruit'} :
              {id:91,entity:'opportunity',track:'protection',raw_stage:'发现',mapped_stage:'需求线索',record_type:'insurance'};
            return {...this.directoryResult,rows:[{...row,person_id:71,person_name:person.display_name}],page:args.page};
          }
          if(name==='funnel_insight')return {funnels:[{key:'opportunity',stages:[{stage:'发现',count:4},{stage:'关闭',count:2}]}]};
          if(name==='person_360'&&args.action==='getOpportunityDirectoryDetails')return {opportunity:open,actions:[
            {id:5,title:'【系统测试·勿联系】虚构行动',status:'open'}],outcomes:[
            {id:6,outcome_type:'opportunity_sale',result:'【系统测试·勿联系】虚构成交结果',occurred_at:'2026-10-16',action_id:5}]};
          if(name==='person_360'&&args.action==='search')return {candidates:[{id:71,display_name:person.display_name}]};
          if(name==='person_360'&&args.action==='previewOpportunity')return {previewId:'11111111-1111-4111-8111-111111111111',preview:{personName:person.display_name}};
          if(name==='person_360'&&args.action==='executeOpportunity'){this.executions.push(args);return {ok:true};}
          throw Error('Unexpected call '+name+' '+JSON.stringify(args));
        }};
      const ctx={main:document.getElementById('pc15-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc15-host'})),
        api:{call:(name,args)=>window.pc15.call(name,args)},toast:(message)=>{window.pc15.lastToast=message}};
      window.pc15ctx=ctx;await renderOpportunities(ctx);
    })()`);
    await browser.wait("document.querySelector('#pc15-host .opp-row-main')");
    assert.doesNotMatch(await browser.evaluate("document.querySelector('#pc15-host').innerText"), /Person-only|旧漏斗/);
    for(const view of ['recruitment','due','records','protection']) {
      await browser.evaluate(`document.querySelector('#pc15-host [data-view="${view}"]').click()`);
      await browser.wait(`window.pc15.calls.filter(c=>c.args.action==='listOpportunityDirectory').at(-1)?.args.kind==='${view}'`);
      await browser.wait("!!document.querySelector('#pc15-host .opp-row-main')");
      assert.equal(await browser.evaluate("document.querySelector('#pc15-host [aria-pressed=true]').dataset.view"),view);
      if(view==='recruitment') assert.match(await browser.evaluate("document.querySelector('.opp-row-note').innerText"), /互动暖客.*待核实/s);
    }
    await browser.evaluate(`(()=>document.querySelector('#pc15-host .opp-pagination button:last-child').click())()`);
    await browser.wait("window.pc15.calls.some(c=>c.args.action==='listOpportunityDirectory'&&c.args.page===2)");

    await browser.evaluate(`(()=>{const i=document.querySelector('#pc15-host .opp-text-filter .opp-query-input');i.value='虚构机会甲';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    await browser.wait("window.pc15.calls.some(c=>c.args.action==='listOpportunityDirectory'&&c.args.query==='虚构机会甲')");
    const searchClicked=await browser.evaluate(`(()=>{const i=document.querySelector('#pc15-host .opp-person-filter .opp-query-input');
      const button=document.querySelector('#pc15-host .opp-person-filter > button');i.value='虚构人物';button.click();
      return {input:i.value,button:!!button,callCount:window.pc15.calls.filter(c=>c.args.action==='search').length}})()`);
    assert.equal(searchClicked.button,true,JSON.stringify(searchClicked));
    await browser.wait("window.pc15.calls.some(c=>c.args.action==='search')");
    await new Promise((resolve)=>setTimeout(resolve,250));
    const personSearchState=await browser.evaluate("(()=>({text:document.querySelector('#pc15-host .opp-person-results').innerText,calls:window.pc15.calls.filter(c=>c.args.action==='search')}))()");
    assert.ok(personSearchState.text.includes('虚构机会甲')||personSearchState.text.includes('虚构体验甲'),JSON.stringify(personSearchState));
    await browser.evaluate("document.querySelector('#pc15-host .opp-person-result').click()");
    await browser.wait("window.pc15.calls.some(c=>c.args.action==='listOpportunityDirectory'&&c.args.personId==='71')");

    await browser.evaluate("document.querySelector('#pc15-host .opp-row-main').click()");
    await browser.wait("document.querySelector('.sheet .opp-detail-actions')");
    assert.ok((await browser.evaluate("document.querySelector('.sheet').innerText")).includes('成交与关闭历史'));
    await browser.evaluate("document.querySelector('.opp-detail-actions .btn-ghost').click()");
    await browser.wait("document.querySelector('.sheet .sheet-actions .btn-primary')");
    await browser.evaluate("document.querySelector('.sheet .sheet-actions .btn-primary').click()");
    await browser.wait("document.querySelector('.sheet .sheet-preview')||document.querySelector('.sheet .preview-block')||document.querySelector('.sheet .sheet-actions .btn-primary')?.innerText.includes('确认执行')");
    assert.equal(await browser.evaluate('window.pc15.executions.length'),0,'edit preview must not write');
    await browser.evaluate(`(()=>{const buttons=[...document.querySelectorAll('.sheet .sheet-actions .btn-primary')];buttons[buttons.length-1].click()})()`);
    await browser.wait('window.pc15.executions.length===1');

    await browser.evaluate(`(()=>{window.pc15I18n.setLang('en');return import('/crm/js/modules/console/pages/opportunities.js').then(m=>m.renderOpportunities(window.pc15ctx))})()`);
    await browser.wait("document.querySelector('#pc15-host').innerText.includes('Customer Protection')");
    for(const [width,height] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const metrics=await browser.evaluate(`(()=>({width:innerWidth,doc:document.documentElement.scrollWidth,host:document.querySelector('#pc15-host').scrollWidth,client:document.querySelector('#pc15-host').clientWidth}))()`);
      assert.ok(metrics.doc<=width+1,`document overflow ${JSON.stringify(metrics)}`);
      assert.ok(metrics.host<=metrics.client+1,`opportunity page overflow ${JSON.stringify(metrics)}`);
    }
    await browser.healthy();
  }finally{await browser.close();}
});
