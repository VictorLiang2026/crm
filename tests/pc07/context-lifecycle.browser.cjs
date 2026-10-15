'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person facts show provenance and require a reviewed preview before execute on iPad orientations', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPerson}=await import('/crm/js/modules/console/pages/person.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      i18n.setLang('en');window.contextEnglish={confirm:i18n.t('context_action_confirm'),source:i18n.t('context_source_text')};
      i18n.setLang('zh-CN');
      window.contextCalls=[];window.contextWrites=0;
      const row={id:11,personId:71,category:'need',content:'【系统测试·勿联系】候选事实',origin:'ai_quick_capture_v2#301',
        sourceType:'ai_quick_capture_v2',sourceId:301,interactionId:301,
        sourceInteraction:{id:301,type:'meeting',at:'2026-10-10T10:00:00Z',summary:'【系统测试·勿联系】原始来源文字',rawNote:'原始备忘'},
        confirmed:false,validity:'current',updatedAt:'2026-10-10T10:00:00Z',needsReview:false};
      const ctx={main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.contextCalls.push({name,args});
        if(name==='person_360'&&args.action==='get')return {person:{id:71,display_name:'【系统测试·勿联系】虚构人物'},members:[]};
        if(name==='person_360'&&args.action==='getCustomerProfile')return {status:'person_only',fields:{}};
        if(name==='person_360'&&args.action==='listPersonWorkItems')return {rows:[],personName:'【系统测试·勿联系】虚构人物'};
        if(name==='person_360'&&args.action==='listInteractions')return {rows:[]};
        if(name==='person_360'&&args.action==='getContextGroups')return {groups:{fact:[row],signal:[],inference:[]}};
        if(name==='person_360'&&args.action==='previewContextItem')return {previewId:'d2be653a-6ee4-4e42-bceb-111111111111',
          preview:{personName:'【系统测试·勿联系】虚构人物',before:{type:'fact',content:row.content,confirmed:false},
            after:{type:'fact',content:row.content,confirmed:true},source:{sourceType:row.sourceType,sourceId:301,
              evidence:{summary:'【系统测试·勿联系】原始来源文字',rawNote:'原始备忘'}}},expiresAt:'2026-10-15T13:00:00Z'};
        if(name==='person_360'&&args.action==='executeContextItem'){window.contextWrites++;return {ok:true};}
        throw Error('unexpected call '+name+' '+args.action);
      }}};
      window.renderContextPerson=()=>renderPerson(ctx,'71');window.renderContextPerson();
    })()`);
    await b.wait("document.querySelector('.person-tabs') || document.querySelector('.tabs')");
    await b.evaluate(`(()=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='事实与洞察').click())()`);
    await b.wait("document.querySelector('.list-row')?.innerText.includes('候选事实')");
    assert.deepEqual(await b.evaluate('window.contextEnglish'),{confirm:'Confirm fact',source:'Original source'});
    assert.equal(await b.evaluate("document.querySelector('.list-row').innerText.includes('原始来源文字')"), true);
    assert.equal(await b.evaluate("document.querySelector('.list-row').innerText.includes('待核实')"), true);
    assert.equal(await b.evaluate("window.contextCalls.some(x=>x.args?.action==='previewContextItem'||x.args?.action==='executeContextItem')"), false,
      'opening the facts page must not confirm or write candidates');
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await b.evaluate(`(()=>[...document.querySelectorAll('.list-row button')].find(x=>x.textContent.trim()==='确认事实').click())()`);
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('原始来源文字')");
    assert.equal(await b.evaluate("document.querySelector('.sheet-overlay').innerText.includes('变更前')"), true);
    assert.equal(await b.evaluate("document.querySelector('.sheet-overlay').innerText.includes('确认后')"), true);
    assert.equal(await b.evaluate('window.contextWrites'),0,'preview does not write business data');
    await b.evaluate(`(()=>[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='确认并保存').click())()`);
    await b.wait('window.contextWrites===1');
    assert.equal(await b.evaluate('window.contextWrites'),1);
    await b.healthy();
    assert.deepEqual(b.networkViolations,[]);
  } finally { await b.close(); }
});
