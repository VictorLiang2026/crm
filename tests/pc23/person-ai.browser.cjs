'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person AI history shows sourced outputs and legacy advice on iPad in both languages', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/people', 'authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderPerson}=await import('/crm/js/modules/console/pages/person.js');
      const {data}=await import('/crm/js/modules/console/data.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      data.personHome=async()=>({person:{id:783,display_name:'【系统测试·勿联系】虚构体验甲'},customerId:788});
      data.customerProfile=async()=>({status:'linked',fields:{customer_name:'【系统测试·勿联系】虚构体验甲'}});
      data.personWorkItems=async()=>({rows:[]});
      data.personInteractions=async()=>({rows:[]});
      data.conversationPlaybookHistory=async()=>({ok:true,hasResult:false});
      window.historyCalls=0;
      data.personAIHistory=async()=>{window.historyCalls++;if(window.historyCalls===1)return {ok:false,error:{message:'temporary history error'}};return {ok:true,generated:[{id:'1',taskType:'meeting_prep',skillVersion:'2.0.0',createdAt:'2026-10-16',result:{brief30Seconds:'Review verified source'},sources:[{schema:'public',table:'knowledge_items',id:'11',label:'Verified clause'}]}],legacy:[{id:'9',createdAt:'2026-10-15',recommendationDate:'2026-10-15',suggestedMessage:'Ask before sending',suggestedStrategy:'Confirm the need',source:{schema:'public',table:'ai_recommendations',id:'9'}}]};};
      window.personI18n=i18n;window.renderTestPerson=()=>renderPerson({main:document.querySelector('.console-main'),api:{call:async()=>({})},toast:()=>{}},'783');
      window.renderTestPerson();
    })()`);
    await browser.wait("document.querySelector('.console-main button')");
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].find(x=>x.textContent.trim()==='AI 历史').click()");
    await browser.wait("document.querySelector('.error-box button')");
    await browser.evaluate("document.querySelector('.error-box button').click()");
    await browser.wait("document.querySelector('.ai-history-row')");
    assert.equal(await browser.evaluate('window.historyCalls'),2,'failed history load is retried explicitly');
    const zh = await browser.evaluate(`({text:document.querySelector('.console-main').innerText,
      evidenceHref:document.querySelector('a[href*="knowledge-governance"]')?.getAttribute('href'),
      writes:0})`);
    assert.match(zh.text,/AI 历史与旧建议/);
    assert.match(zh.text,/Ask before sending/);
    assert.equal(zh.evidenceHref,'#/knowledge-governance?item=11');
    await browser.evaluate("window.personI18n.setLang('en');window.renderTestPerson() ");
    await browser.wait("[...document.querySelectorAll('.console-main button')].some(x=>x.textContent.trim()==='AI History')");
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].find(x=>x.textContent.trim()==='AI History').click()");
    await browser.wait("document.querySelector('.ai-history-row')");
    const en = await browser.evaluate("document.querySelector('.console-main').innerText");
    assert.match(en,/AI History & Legacy Advice/);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
