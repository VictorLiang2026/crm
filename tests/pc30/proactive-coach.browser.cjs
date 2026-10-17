'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC30 Today candidate stays review-only until a server preview and explicit Action confirmation',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.openConsole('#/today','authCase=1');
    await browser.evaluate(`(async()=>{
      const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
      const {renderProactiveCoach}=await import('/crm/js/modules/console/proactive-coach.js');
      const candidate={type:'commitment_due',sourceType:'commitment_due',sourceId:9901,candidateKey:'a2f46ad8-54fc-5374-8321-5127e82dd8cd',
        personId:9902,personName:'【系统测试·勿联系】虚构 Person',source:'public.commitments#9901',target:'#/person/9902',
        windowStart:'2026-10-18T04:00:00Z',windowEnd:'2026-10-17T04:00:00Z',confidence:.95,priority:'high',
        data:{dueAt:'2026-10-18T04:00:00Z'},title:'虚构承诺',reasonKey:'pc30_commitment_reason',
        actionDraft:{titleKey:'pc30_action_commitment_title',descriptionKey:'pc30_action_commitment_description',
          templateArgs:{content:'fictional commitment',source:'public.commitments#9901',candidateKey:'a2f46ad8-54fc-5374-8321-5127e82dd8cd'},
          priority:'medium',dueAt:'2026-10-18T04:00:00Z'},
        testData:{status:'verified',containsTestData:false},canCreateAction:true};
      window.pc30={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='person_360'&&args.action==='listProactiveCoachCandidates')return {candidates:[candidate],hasMore:false,disclosure:{status:'verified',containsTestData:false}};
        if(name==='person_360'&&args.action==='previewWorkItem'){this.workPreview=args.data;return {previewId:'9903',expiresAt:'2026-10-17T04:15:00Z',preview:{personId:9902,personName:candidate.personName,after:args.data.draft}};}
        if(name==='person_360'&&args.action==='executeWorkItem')return {itemId:9904,replayed:false};
        if(name==='person_360'&&args.action==='recordProactiveCoachDecision')return {ok:true,replayed:false};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));}};
      const ctx={api:{call:(name,args)=>window.pc30.call(name,args)},toast:()=>{}};window.pc30.ctx=ctx;
      const host=document.createElement('div');host.id='pc30-host';document.body.appendChild(host);host.appendChild(await renderProactiveCoach(ctx));
    })()`);
    await browser.wait("document.querySelector('#pc30-host').textContent.includes('虚构 Person')");
    assert.equal(await browser.evaluate("window.pc30.calls.some(x=>x.args.action==='previewWorkItem'||x.args.action==='executeWorkItem')"),false);
    await browser.click('#pc30-host button','预览并建行动');
    await browser.click('.sheet-overlay button','获取服务端预览');
    await browser.wait("window.pc30.calls.some(x=>x.args.action==='previewWorkItem')");
    assert.equal(await browser.evaluate('window.pc30.workPreview.draft.title'),'履行承诺：fictional commitment');
    assert.equal(await browser.evaluate("window.pc30.calls.some(x=>x.args.action==='executeWorkItem')"),false);
    await browser.click('.sheet-overlay button','确认创建 Action');
    await browser.wait("window.pc30.calls.some(x=>x.args.action==='recordProactiveCoachDecision')");
    const calls=await browser.evaluate('window.pc30.calls.map(x=>x.args.action)');
    assert.deepEqual(calls,['listProactiveCoachCandidates','previewWorkItem','executeWorkItem','recordProactiveCoachDecision']);
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
    await browser.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
      document.querySelector('#pc30-host').replaceChildren(await (await import('/crm/js/modules/console/proactive-coach.js')).renderProactiveCoach(window.pc30.ctx));})()`);
    await browser.wait("document.querySelector('#pc30-host').textContent.includes('Proactive Coach')");
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'iPad width should not overflow');
    await browser.click('#pc30-host button','Preview Action');
    await browser.click('.sheet-overlay button','Get server preview');
    await browser.wait("window.pc30.calls.filter(x=>x.args.action==='previewWorkItem').length===2");
    assert.equal(await browser.evaluate('window.pc30.workPreview.draft.title'),'Follow up on commitment: fictional commitment');
    await browser.healthy();
  }finally{await browser.close();}
});
