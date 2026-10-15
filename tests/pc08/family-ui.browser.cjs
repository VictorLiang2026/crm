'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person family page handles bilingual multi-household review flows at iPad sizes', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {renderPerson}=await import('/crm/js/modules/console/pages/person.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      window.familyI18n=i18n; window.familyCalls=[]; window.familyExec=[];
      const household={id:10,anchor_person_id:1,important_facts:'legacy unreviewed',important_facts_confirmed_at:null,
        important_facts_confirmed_by_uid:null,updated_at:'2026-10-01'};
      const other={id:20,anchor_person_id:2,important_facts:null,important_facts_confirmed_at:null,updated_at:'2026-10-02'};
      const groups=[{household,anchor:{id:1,display_name:'【系统测试·勿联系】锚点'},members:[
        {id:100,household_id:10,person_id:3,relationship_to_anchor:'spouse',confirmed_at:'2026-10-01',person:{id:3,display_name:'【系统测试·勿联系】成员'}}],isAnchor:true,currentMembership:null},
        {household:other,anchor:{id:2,display_name:'【系统测试·勿联系】另一锚点'},members:[
          {id:200,household_id:20,person_id:71,relationship_to_anchor:'child',confirmed_at:'2026-10-02',person:{id:71,display_name:'【系统测试·勿联系】虚构人物'}}],isAnchor:false,
          currentMembership:{id:200,relationship_to_anchor:'child'}}];
      const ctx={main:document.getElementById('view'),toast(){},onWriteDone(){window.familyRefresh=(window.familyRefresh||0)+1},api:{call:async(name,args)=>{
        window.familyCalls.push({name,...args});
        if(name==='person_360'&&args.action==='get')return {person:{id:71,display_name:'【系统测试·勿联系】虚构人物'},household,members:groups[0].members,households:groups};
        if(name==='person_360'&&args.action==='resolveHouseholdMember')return {candidates:[{id:'4',displayName:'【系统测试·勿联系】候选成员',occupation:'顾问'}]};
        if(name==='person_360'&&args.action==='previewHousehold')return {previewId:'c13ea68b-5a87-4554-88bd-82b29f37ec37',expiresAt:'2026-10-15T15:00:00Z',
          preview:{personId:71,personName:'【系统测试·勿联系】虚构人物',before:{facts:'legacy unreviewed'},after:{facts:args.data.facts||null,memberName:'【系统测试·勿联系】候选成员',relationship:args.data.relationship||'spouse'}}};
        if(name==='person_360'&&args.action==='executeHousehold'){window.familyExec.push(args);return {ok:true}};
        throw Error('Unexpected call '+name+' '+args.action);
      }}};
      window.renderFamilyPerson=()=>renderPerson(ctx,'71'); await window.renderFamilyPerson();
    })()`);
    await browser.wait("document.querySelectorAll('.tab').length>=8");
    await browser.evaluate(`(()=>[...document.querySelectorAll('.tab')].find(x=>x.textContent.trim()==='家庭与关系').click())()`);
    await browser.wait("document.querySelector('.family-household')?.innerText.includes('legacy unreviewed')");
    assert.equal(await browser.evaluate("document.getElementById('view').innerText.includes('待核实')"), true);
    assert.equal(await browser.evaluate("window.familyCalls.some(call=>call.action==='previewHousehold'||call.action==='executeHousehold')"), false);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.evaluate(`(()=>{window.familyI18n.setLang('en');window.familyEnglish={unknown:window.familyI18n.t('family_unknown'),review:window.familyI18n.t('family_review_title')};window.familyI18n.setLang('zh-CN')})()`);
    assert.deepEqual(await browser.evaluate('window.familyEnglish'),{unknown:'Family status unknown',review:'Review family change'});

    await browser.evaluate(`(()=>[...document.querySelectorAll('.family-household button')].find(x=>x.textContent.trim()==='审核或更新事实').click())()`);
    await browser.wait("document.querySelector('.sheet textarea')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet textarea').value='已核实家庭事实';[...document.querySelectorAll('.sheet button')].find(x=>x.textContent.trim()==='预览并审核保存').click()})()`);
    await browser.wait("document.querySelector('.sheet-overlay')?.innerText.includes('执行后')");
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay').innerText.includes('已核实家庭事实')"),true);
    assert.equal(await browser.evaluate('window.familyExec.length'),0);
    await browser.evaluate(`(()=>[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='确认并执行').click())()`);
    await browser.wait('window.familyExec.length===1');
    assert.equal((await browser.evaluate('window.familyCalls.filter(call=>call.action===\'previewHousehold\').at(-1).operation')), 'save_facts');

    await browser.evaluate(`(()=>[...document.querySelectorAll('.family-household button')].find(x=>x.textContent.trim()==='添加家庭成员').click())()`);
    await browser.wait("document.querySelector('.sheet input[type=search]')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=search]').value='【系统测试·勿联系】候选成员';[...document.querySelectorAll('.sheet button')].find(x=>x.textContent.trim()==='解析并选择人物').click()})()`);
    await browser.wait("[...document.querySelectorAll('.sheet button')].some(x=>x.textContent.includes('候选成员'))");
    await browser.evaluate(`(()=>[...document.querySelectorAll('.sheet button')].find(x=>x.textContent.includes('候选成员')).click())()`);
    await browser.wait("document.querySelector('.sheet-overlay')?.innerText.includes('执行后')");
    assert.equal(await browser.evaluate('window.familyExec.length'),1,'member preview alone does not write');
    await browser.evaluate(`(()=>[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='确认并执行').click())()`);
    await browser.wait('window.familyExec.length===2');
    const addPreview=await browser.evaluate("window.familyCalls.filter(call=>call.action==='previewHousehold').at(-1)");
    assert.equal(addPreview.operation,'add_member');
    assert.equal(addPreview.data.memberId,'4');
    await browser.healthy();
  } finally { await browser.close(); }
});
