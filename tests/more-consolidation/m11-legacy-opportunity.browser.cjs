'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M11 legacy same-ID edit/close, stale preview reset, uncertain execute replay and readback recovery',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');
  await b.evaluate(`(async()=>{
   const {renderOpportunities}=await import('/crm/js/modules/console/pages/opportunities.js');
   window.m11Open=(await import('/crm/js/modules/console/legacy-opportunity.js')).openLegacyOpportunity;
   window.m11={calls:[],previews:new Map(),done:new Map(),previewFail:true,stale:true,loseResponse:true,readFail:true,writeCount:0,outcomes:0,
     person:{id:71,display_name:'【系统测试·勿联系】旧客户甲'},
     opp:{id:91,person_id:null,customer_id:301,opportunity_type:'转介绍',status:'潜在线索',last_progress:'旧进展',next_action:'旧行动',
       next_action_date:'2026-11-01',discovered_at:'2026-10-01',referred_name:'虚构乙',referred_relation:'同事'},
     actions:[{id:5,person_id:71,opportunity_id:91,title:'已关联行动'},{id:6,person_id:72,opportunity_id:91,title:'其他人物行动'}],
     async call(name,args){this.calls.push({name,args});
       if(name==='funnel_insight')return {funnels:[]};
       if(args.action==='listPendingOpportunityCandidates')return {rows:[]};
       if(args.action==='listOpportunityDirectory')return {rows:[{...this.opp,person:this.person}],page:1,pageSize:20,total:1,hasMore:false,countsByStatus:{潜在线索:1}};
       if(args.action==='getOpportunityDirectoryDetails'){
         if(this.writeCount&&this.readFail)throw Error('readback unavailable');
         return {opportunity:{...this.opp,person:this.person},actions:this.actions,outcomes:[]};}
       if(args.action==='previewLegacyOpportunity'){
         if(this.previewFail){this.previewFail=false;throw Error('preview unavailable');}
         const id='00000000-0000-4000-8000-'+String(this.previews.size+1).padStart(12,'0');this.previews.set(id,args.data);
         const before={type:this.opp.opportunity_type,status:this.opp.status,progress:this.opp.last_progress};
         return {previewId:id,status:'preview',preview:{opportunityId:91,personName:this.person.display_name,before,after:{...before,...args.data.draft}}};}
       if(args.action==='executeLegacyOpportunity'){
         if(this.stale){this.stale=false;throw Error('Opportunity or linked identity changed; preview again');}
         if(this.done.has(args.previewId))return {...this.done.get(args.previewId),replayed:true};
         const request=this.previews.get(args.previewId);this.writeCount++;
         if(request.operation==='edit'){this.opp.last_progress=request.draft.progress;this.opp.opportunity_type=request.draft.type;}
         this.opp.status=request.draft.status;
         const done={opportunityId:91,outcomeId:request.operation==='close'?++this.outcomes:null};this.done.set(args.previewId,done);
         if(this.loseResponse){this.loseResponse=false;throw Error('lost response after commit');}return done;}
       throw Error('Unexpected '+name+'.'+args.action);
     }};
   window.m11ctx={main:document.getElementById('view'),api:{call:(n,a)=>m11.call(n,a)},toast:()=>{}};
   await renderOpportunities(m11ctx);
  })()`);
  await b.wait("document.querySelector('.opp-row-main')");await b.evaluate("document.querySelector('.opp-row-main').click()");
  await b.wait("document.querySelector('.legacy-opp-edit')");
  assert.equal(await b.evaluate("document.querySelector('.opp-detail-actions a').getAttribute('href')"),'/crm/admin.html#/customer/301');
  await b.evaluate("document.querySelector('.legacy-opp-edit').click()");
  await b.wait("document.querySelector('.legacy-opportunity-form')");
  assert.deepEqual(await b.evaluate("['type','status','referredName'].map(k=>document.querySelector('.legacy-opportunity-fields [name='+k+']').value)"),['转介绍','潜在线索','虚构乙']);
  await b.evaluate("document.querySelector('[name=progress]').value='新进展';document.querySelector('[name=progress]').dispatchEvent(new Event('input'))");
  await b.click('.legacy-opportunity-form > button','生成服务端预览');
  await b.wait("document.querySelector('.legacy-opportunity-form > .sheet-err').textContent.includes('预览未生成')");
  assert.equal(await b.evaluate("document.querySelector('[name=progress]').value"),'新进展');
  await b.click('.legacy-opportunity-form > button','生成服务端预览');
  await b.wait("document.querySelector('.legacy-opportunity-preview input[type=checkbox]')");
  assert.equal(await b.evaluate("document.querySelector('.legacy-opportunity-preview button').disabled"),true);
  const first=await b.evaluate("m11.calls.filter(x=>x.args.action==='previewLegacyOpportunity').map(x=>x.args.data)");
  assert.equal(first[0].idempotencyKey,first[1].idempotencyKey);assert.equal(first[1].opportunityId,'91');assert.equal(first[1].customerId,'301');assert.equal(first[1].personId,'71');
  await b.evaluate("document.querySelector('.legacy-opportunity-preview input').click();document.querySelector('.legacy-opportunity-preview button').click()");
  await b.wait("document.querySelector('.legacy-opportunity-form > .sheet-err').textContent.includes('重新生成预览')");
  assert.equal(await b.evaluate("document.querySelector('.legacy-opportunity-preview input')"),null);
  await b.click('.legacy-opportunity-form > button','生成服务端预览');await b.wait("document.querySelector('.legacy-opportunity-preview input')");
  assert.notEqual(await b.evaluate("m11.calls.filter(x=>x.args.action==='previewLegacyOpportunity').at(-1).args.data.idempotencyKey"),first[0].idempotencyKey);
  await b.evaluate("document.querySelector('.legacy-opportunity-preview input').click();document.querySelector('.legacy-opportunity-preview button').click()");
  await b.wait("document.querySelector('.legacy-opportunity-form > .sheet-err').textContent.includes('尚未收到执行成功回执')");
  await b.evaluate("document.querySelector('.legacy-opportunity-preview button').click()");
  await b.wait("document.querySelector('.legacy-opportunity-receipt').textContent.includes('回读暂时失败')");
  assert.equal(await b.evaluate('m11.writeCount'),1);assert.equal(await b.evaluate("document.querySelector('.legacy-opportunity-form > button').disabled"),true);
  const executes=await b.evaluate("m11.calls.filter(x=>x.args.action==='executeLegacyOpportunity').map(x=>x.args.previewId)");
  assert.equal(executes.at(-1),executes.at(-2));
  await b.evaluate('m11.readFail=false');await b.click('.legacy-opportunity-receipt button','重新读取原记录');
  await b.wait("document.querySelector('.legacy-opportunity-receipt').textContent.includes('修改已保存')");
  assert.equal(await b.evaluate('m11.writeCount'),1);
  await b.evaluate("document.querySelector('.sheet-overlay').remove();m11Open(m11ctx,{opportunity:m11.opp,person:m11.person,actions:m11.actions,mode:'advance'})");
  await b.evaluate("document.querySelector('[name=status]').value='关闭';document.querySelector('[name=status]').dispatchEvent(new Event('change'))");
  assert.deepEqual(await b.evaluate("[...document.querySelector('[name=actionId]').options].map(x=>x.value)"),['','5']);
  const previewsBefore=await b.evaluate('m11.previews.size');await b.click('.legacy-opportunity-form > button','生成服务端预览');
  await b.wait("document.querySelector('.legacy-opportunity-form > .sheet-err').textContent.includes('请填写结果')");
  assert.equal(await b.evaluate('m11.previews.size'),previewsBefore);
  await b.evaluate("document.querySelector('[name=result]').value='【系统测试·勿联系】暂缓';document.querySelector('[name=actionId]').value='5'");
  await b.click('.legacy-opportunity-form > button','生成服务端预览');await b.wait("document.querySelector('.legacy-opportunity-preview input')");
  await b.evaluate("document.querySelector('.legacy-opportunity-preview input').click();document.querySelector('.legacy-opportunity-preview button').click()");
  await b.wait("document.querySelector('.legacy-opportunity-receipt').textContent.includes('结果记录编号')");
  assert.equal(await b.evaluate('m11.outcomes'),1);assert.equal(await b.evaluate('m11.opp.id'),91);
  assert.equal(await b.evaluate("m11.calls.some(x=>['previewOpportunity','executeOpportunity'].includes(x.args.action)||x.name==='opportunities')"),false);
  for(const lang of ['zh-CN','en']){
   await b.evaluate(`(async()=>{document.querySelectorAll('.sheet-overlay').forEach(x=>x.remove());(await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');m11.opp.status='潜在线索';m11Open(m11ctx,{opportunity:m11.opp,person:m11.person,mode:'edit'});})()`);
   const types=await b.evaluate("[...document.querySelector('[name=type]').options].slice(0,6).map(x=>x.textContent)");assert.equal(new Set(types).size,6);
   for(const [width,height]of [[820,1180],[1180,820]]){await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
     assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,lang+' '+width);}
  }
  await b.healthy();
 }finally{await b.close();}
});
