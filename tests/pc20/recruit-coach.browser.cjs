'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC20 synthetic candidate requires human decision before Action and Outcome writes',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {renderRecruitSection}=await import('/crm/js/modules/console/recruit-write.js');
      const candidate={id:9402,person_id:9401,stage:'新增人才',updated_at:'2026-10-16T05:00:00.000Z',
        potential_score:60,potential_reason:'legacy fixture',motivation:'虚构测试动机'};
      const context={assessment:'虚构评估',dimensions:['industry_resources','learning_ability','resilience','communication','entrepreneurial_motivation','cultural_fit'].map(key=>({key,weight:10,score:70,rationale:'虚构依据',evidenceRefs:['public.recruit_candidates#9402']})),
        totalScore:70,totalScoreNoteCode:null,uncertainty:'虚构信息有限',uncertaintyCode:null,confidence:'medium',
        sourceRefs:['public.recruit_candidates#9402'],evidenceSources:[{ref:'public.recruit_candidates#9402',sourceType:'candidate',fields:[{key:'motivation',value:'虚构测试动机'}]}],
        contactSuggestion:{assumptionReasons:['虚构假设'],clarifyingQuestions:['虚构问题'],prohibitedPhrasing:['勿承诺收入'],nextStep:'询问兴趣方向'}};
      window.pc20={calls:[],history:[],async call(name,args){this.calls.push({name,args});
        if(name==='person_360'&&args.action==='listRecruitContext')return{rows:[{id:'9402',stage:'新增人才'}]};
        if(name==='person_360'&&args.action==='get')return{person:{display_name:'【系统测试·勿联系】PC20虚构候选人'}};
        if(name==='person_360'&&args.action==='getRecruitCandidate')return{candidate,milestones:[],followups:[]};
        if(name==='assistant'&&args.operation==='history')return{history:this.history};
        if(name==='assistant'&&args.operation==='generate'){this.history=[{resultId:'9404',taskId:'9403',createdAt:'2026-10-17T00:00:00Z',result:context}];return{status:'generated',resultId:'9404',result:context};}
        if(name==='assistant'&&args.operation==='decision'){this.decision=args.decision;this.history[0].decision=args.decision;return{ok:true};}
        if(name==='person_360'&&args.action==='previewWorkItem'){this.workPreview=args.data;return{previewId:'work-preview-1',preview:{personName:'【系统测试·勿联系】PC20虚构候选人',after:args.data.draft}};}
        if(name==='person_360'&&args.action==='executeWorkItem')return{itemId:'9405'};
        if(name==='person_360'&&args.action==='previewRecruitCoachOutcome')return{previewId:'outcome-preview-1',previewHash:'0123456789abcdef0123456789abcdef'};
        if(name==='person_360'&&args.action==='confirmRecruitCoachOutcome')return{ok:true,status:'confirmed'};
        if(name==='person_360'&&args.action==='executeRecruitCoachOutcome')return{ok:true,outcomeId:'9406'};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const ctx={api:{call:(name,args)=>window.pc20.call(name,args)},operator:{name:'Test'},toast:()=>{}};
      const host=document.createElement('div');host.id='pc20-host';document.body.appendChild(host);
      host.replaceChildren(await renderRecruitSection(ctx,'9401',()=>{}));
    })()`);
    await browser.wait("document.querySelector('#pc20-host .pc20-generate') || document.querySelector('#pc20-host button')");
    await browser.click('#pc20-host button','生成新建议');
    await browser.wait("window.pc20.history.length===1 && document.querySelector('#pc20-host').textContent.includes('询问兴趣方向')");
    assert.equal(await browser.evaluate("window.pc20.calls.some(x=>x.args.action==='previewWorkItem'||x.args.action==='previewRecruitCoachOutcome')"),false);
    await browser.click('#pc20-host button','接受建议');
    await browser.wait("window.pc20.decision==='accepted' && document.querySelector('#pc20-host').textContent.includes('按建议新建行动')");
    await browser.click('#pc20-host button','按建议新建行动');
    await browser.wait("document.querySelector('.sheet-overlay textarea')");
    await browser.click('.sheet-overlay button','生成预览');
    await browser.wait("window.pc20.workPreview");
    await browser.click('.sheet-overlay button','确认并执行');
    await browser.wait("window.pc20.calls.some(x=>x.args.action==='executeWorkItem')");
    await browser.click('#pc20-host button','记录实际跟进结果');
    await browser.wait("document.querySelector('.sheet-overlay textarea')");
    await browser.evaluate(`(()=>{const o=document.querySelector('.sheet-overlay textarea');o.value='【系统测试·勿联系】虚构沟通结果';
      const d=document.querySelector('.sheet-overlay input[type=datetime-local]');d.value='2026-10-17T10:00';})()`);
    await browser.click('.sheet-overlay button','预览结果');
    await browser.wait("window.pc20.calls.some(x=>x.args.action==='previewRecruitCoachOutcome')");
    await browser.click('.sheet-overlay button','确认并保存结果');
    await browser.wait("window.pc20.calls.some(x=>x.args.action==='executeRecruitCoachOutcome')");
    const result=await browser.evaluate('window.pc20');
    assert.equal(result.calls.some(x=>x.name==='assistant'&&x.args.operation==='decision'&&x.args.decision==='accepted'),true);
    assert.equal(result.workPreview.draft.title,'询问兴趣方向');
    assert.equal(result.calls.some(x=>x.args.action==='confirmRecruitCoachOutcome'),true);
    assert.equal(result.calls.some(x=>x.args.action==='executeRecruitCoachOutcome'),true);
    await browser.healthy();
  }finally{await browser.close();}
});
