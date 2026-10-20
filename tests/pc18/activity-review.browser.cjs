'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC18 displays review history and requires server preview then explicit confirmation for all writes',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('en');
      const {renderActivityReview}=await import('/crm/js/modules/console/activity-review.js');
      const review={summary:'【系统测试·勿联系】虚构复盘摘要',whoMattered:[{text:'到场反馈',sourceRefs:['public.interactions#50']}],
        whatChanged:[],relationshipsImproved:[],signalsAppeared:[],opportunitiesAppeared:[],followUpPeople:[],
        actionCandidates:[{personId:9001,personName:'虚构人物甲',sourceIndex:1,title:'跟进反馈',reason:'虚构理由',sourceRefs:['public.interactions#50']}],
        opportunityCandidates:[{personId:9002,personName:'虚构人物乙',sourceIndex:2,opportunityType:'activity',reason:'虚构理由',nextAction:'发送资料',sourceRefs:['public.interactions#51']}]};
      const history={activity:{id:42,name:'【系统测试·勿联系】活动甲'},versions:[{id:30,taskId:20,createdAt:'2026-10-16T01:00:00Z',summary:review.summary,
        review,actionCandidates:review.actionCandidates,opportunityCandidates:review.opportunityCandidates,decisions:[]}],outcomes:[],
        testData:{status:'verified',containsTestData:false}};
      window.pc18={history,calls:[],writes:[],preview:null,failNextExecute:true,
        async call(name,args){this.calls.push({name,args});
          if(name==='person_360'&&args.action==='listActivityReviewHistory')return this.history;
          if(name==='ai_activity'&&args.action==='postReviewV2'){
            this.writes.push('generate');this.history.versions.unshift({id:31,taskId:21,createdAt:'2026-10-16T02:00:00Z',summary:review.summary,
              review,actionCandidates:review.actionCandidates,opportunityCandidates:review.opportunityCandidates,decisions:[]});return {task_id:21,result_id:31};}
          if(name==='person_360'&&args.action==='previewActivityReview'){
            this.preview=args.data;return {previewId:'11111111-1111-4111-8111-111111111111',operation:args.data.operation,
              activityId:42,personId:args.data.operation==='outcome'?null:9001,personName:'虚构人物甲',
              after:args.data.draft,sourceRefs:args.data.operation==='outcome'?[]:['public.interactions#50'],
              expiresAt:'2026-10-16T02:15:00Z',businessDataWritten:false};}
          if(name==='person_360'&&args.action==='executeActivityReview'){
            if(this.failNextExecute&&this.preview.operation==='action'){
              this.failNextExecute=false;throw Error('Activity changed since preview');
            }
            const p=this.preview;this.writes.push(p.operation);const result={status:p.operation.startsWith('reject_')?'rejected':p.operation==='outcome'?'recorded':'accepted',
              kind:p.operation.replace('reject_',''),actionId:p.operation==='action'?71:undefined,
              candidateId:p.operation==='opportunity'?72:undefined,outcomeId:p.operation==='outcome'?81:undefined};
            if(p.operation==='outcome')this.history.outcomes.unshift({id:81,outcome_type:p.draft.outcomeType,result:p.draft.result,occurred_at:p.draft.occurredAt});
            else {const v=this.history.versions.find(x=>String(x.id)===String(p.resultId));v.decisions.push({kind:p.operation.includes('action')?'action':'opportunity',candidateIndex:p.candidateIndex,
              status:p.operation.startsWith('reject_')?'rejected':'accepted',result});}
            return result;}
          throw Error('Unexpected '+name+' '+JSON.stringify(args));
        }};
      const host=document.createElement('div');host.id='pc18-host';document.body.appendChild(host);
      const ctx={main:host,api:{call:(name,args)=>window.pc18.call(name,args)},toast:()=>{}};
      window.pc18ctx=ctx;window.pc18render=renderActivityReview;
      host.replaceChildren(await renderActivityReview(ctx,42));
    })()`);
    await browser.wait("document.querySelector('#pc18-host .pc18-candidate')");
    assert.equal(await browser.evaluate("window.pc18.calls.some(c=>c.name==='ai_activity')"),false,'opening history must not generate a new review');
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host').innerText")).includes('Confidence: Not provided'));
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host').innerText")).includes('public.interactions#50'));

    await browser.evaluate(`(()=>[...document.querySelectorAll('#pc18-host .pc18-candidate button')].find(b=>b.innerText.includes('Edit')).click())()`);
    await browser.click('#pc18-host button','Review & Preview');
    await browser.wait("window.pc18.calls.some(c=>c.args.action==='previewActivityReview')");
    assert.equal(await browser.evaluate("window.pc18.writes.length"),0,'preview cannot write business data');
    assert.equal(await browser.evaluate("window.pc18.preview.operation"),'action');
    assert.equal(await browser.evaluate("window.pc18.preview.candidateIndex"),1,
      'the visible candidate must use its original AI result index');
    await browser.click('#pc18-host button','Confirm & Execute');
    await browser.wait("document.querySelector('#pc18-host .form-msg.error')");
    assert.equal(await browser.evaluate("window.pc18.writes.includes('action')"),false,'stale execution must fail without a write');
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host').innerText")).includes('Activity changed since preview'));
    await browser.click('#pc18-host button','Cancel');
    await browser.click('#pc18-host button','Review & Preview');
    await browser.wait("window.pc18.calls.filter(c=>c.args.action==='previewActivityReview').length===2");
    await browser.click('#pc18-host button','Confirm & Execute');
    await browser.wait("window.pc18.writes.includes('action')");
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host').innerText")).includes('71'));
    assert.equal(await browser.evaluate("window.pc18.history.versions[0].decisions[0].candidateIndex"),1);
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host .pc18-candidate').innerText")).includes('Accepted'));

    await browser.evaluate(`(()=>[...document.querySelectorAll('#pc18-host .pc18-candidate button')].find(b=>b.innerText.includes('Edit')).click())()`);
    await browser.click('#pc18-host button','Preview Candidate Rejection');
    await browser.wait("window.pc18.preview?.operation==='reject_opportunity'");
    assert.equal(await browser.evaluate("window.pc18.preview.candidateIndex"),2);
    assert.equal(await browser.evaluate("window.pc18.writes.includes('reject_opportunity')"),false);
    await browser.click('#pc18-host button','Confirm & Execute');
    await browser.wait("window.pc18.writes.includes('reject_opportunity')");

    await browser.evaluate(`(()=>{const f=[...document.querySelectorAll('#pc18-host textarea')].at(-1);f.value='【系统测试·勿联系】虚构实际结果';document.querySelector('#pc18-host button').focus()})()`);
    await browser.click('#pc18-host button','Review & Preview Outcome');
    await browser.wait("window.pc18.preview?.operation==='outcome'");
    assert.equal(await browser.evaluate("window.pc18.writes.includes('outcome')"),false);
    await browser.click('#pc18-host button','Confirm & Execute');
    await browser.wait("window.pc18.writes.includes('outcome')");
    assert.ok((await browser.evaluate("document.querySelector('#pc18-host').innerText")).includes('81'));

    await browser.click('#pc18-host button','Generate Review Version');
    await browser.wait("window.pc18.writes.includes('generate')");
    assert.equal(await browser.evaluate("window.pc18.history.versions.length"),2);
    await browser.evaluate(`(async()=>{const i=await import('/crm/js/modules/console/i18n.js');i.setLang('zh-CN');document.querySelector('#pc18-host').replaceChildren(await window.pc18render(window.pc18ctx,42))})()`);
    await browser.wait("document.querySelector('#pc18-host').innerText.includes('复盘版本历史')");
    for(const [width,height] of [[820,1180],[1180,820]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const m=await browser.evaluate(`(()=>({doc:document.documentElement.scrollWidth,host:document.querySelector('#pc18-host').scrollWidth,client:document.querySelector('#pc18-host').clientWidth}))()`);
      assert.ok(m.doc<=width+1&&m.host<=m.client+1,`iPad overflow ${JSON.stringify(m)}`);
    }
    await browser.healthy();
  }finally{await browser.close();}
});
