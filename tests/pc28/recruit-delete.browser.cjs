'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
const root=path.resolve(__dirname,'../..');

test('Console requires explicit Person, candidate, preview, confirm and Execute clicks',async()=>{
  const browser=new Browser(root);
  try{
    await browser.start();await browser.openConsole('#/more','authCase=1');
    await browser.wait("document.querySelector('#console-main')");
    await browser.evaluate(`(async()=>{
      const {openRecruitDeleteCommand}=await import('/crm/js/modules/console/recruit-delete.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('zh-CN');window.pc28Calls=[];
      window.openPc28=(lang)=>{if(lang)setLang(lang);return openRecruitDeleteCommand({
        toast(){},api:{call:async(name,p)=>{window.pc28Calls.push({name,p});
          if(name!=='assistant')throw Error('unexpected function');
          if(p.action==='recruitDeleteInterpret')return {ok:true,status:'needs_person_selection',
            proposal:{personMention:'Fictional Lin',candidateMention:'one candidate'},
            candidates:[{id:'786',displayName:'【系统测试·勿联系】虚构人物'}]};
          if(p.action==='recruitDeleteTargets')return {ok:true,person:{id:'786',
            displayName:'【系统测试·勿联系】虚构人物'},candidates:[{id:20,person_id:786,
            customer_id:null,stage:'初次面谈'}],testData:{containsTestData:true}};
          if(p.stage==='plan')return {ok:true,status:'planned',commandId:'11111111-1111-4111-8111-111111111111'};
          if(p.stage==='preview')return {ok:true,status:'previewed',
            previewHash:'a'.repeat(32),expiresAt:'2026-10-18T11:15:00Z',
            preview:{personId:786,personName:'【系统测试·勿联系】虚构人物',
              candidateId:20,candidateStage:'初次面谈',followupCount:1,followupIds:[3],
              alreadyDeletedFollowupCount:0}};
          if(p.stage==='confirm')return {ok:true,status:'confirmed'};
          if(p.stage==='execute')return {ok:true,status:'executed',result:{batchId:'batch-fixture'}};
          throw Error('unexpected stage');}}});};
      window.openPc28();
    })()`);
    await browser.wait("document.querySelector('.sheet-overlay textarea')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('执行删除')).disabled"),true);
    await browser.evaluate(`(()=>{const s=document.querySelector('.sheet-overlay');
      const q=s.querySelector('textarea');q.value='删除 Fictional Lin 的增员候选人';
      q.dispatchEvent(new Event('input',{bubbles:true}));
      [...s.querySelectorAll('button')].find(x=>x.textContent.includes('解释请求')).click();})()`);
    await browser.wait("document.querySelector('.sheet-overlay .sheet-stack button')");
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-stack button').click()");
    await browser.wait("document.querySelectorAll('.sheet-overlay .sheet-stack button').length===2");
    await browser.evaluate("document.querySelectorAll('.sheet-overlay .sheet-stack button')[1].click()");
    await browser.wait("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('生成计划')).disabled===false");
    assert.equal(await browser.evaluate("window.pc28Calls.filter(x=>x.p.stage==='execute').length"),0);
    await browser.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('生成计划')).click()");
    await browser.wait("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('查看影响预览')).disabled===false");
    await browser.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('查看影响预览')).click()");
    await browser.wait("document.querySelector('.sheet-overlay .sheet-preview')?.innerText.includes('服务端影响范围')");
    const before=await browser.evaluate(`({preview:document.querySelector('.sheet-overlay .sheet-preview').innerText,
      executeDisabled:[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('执行删除')).disabled,
      calls:window.pc28Calls.map(x=>x.p.stage||x.p.action)})`);
    assert.match(before.preview,/#786/);assert.match(before.preview,/#20/);
    assert.match(before.preview,/1/);assert.equal(before.executeDisabled,true);
    assert.equal(before.calls.includes('execute'),false);
    await browser.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('确认影响范围')).click()");
    await browser.wait("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('执行删除')).disabled===false");
    assert.equal(await browser.evaluate("window.pc28Calls.filter(x=>x.p.stage==='execute').length"),0);
    await browser.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.includes('执行删除')).click()");
    await browser.wait("document.querySelector('.sheet-overlay .sheet-preview')?.innerText.includes('batch-fixture')");
    assert.equal(await browser.evaluate("window.pc28Calls.filter(x=>x.p.stage==='execute').length"),1);
    for(const size of [{width:820,height:1180},{width:1180,height:820}]){
      await browser.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate("window.openPc28('en')");
    await browser.wait("document.querySelectorAll('.sheet-overlay').length===2");
    assert.match(await browser.evaluate("document.querySelectorAll('.sheet-overlay .sheet-title')[1].innerText"),/Delete Person-only Candidate/);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.sheet-overlay')[1].querySelectorAll('button')].find(x=>x.textContent.includes('Execute Delete')).disabled"),true);
    await browser.healthy();
  }finally{await browser.close();}
});
