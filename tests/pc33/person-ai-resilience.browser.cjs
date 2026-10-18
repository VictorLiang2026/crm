'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC33 Person AI suppresses duplicate clicks and shows bilingual failure/history actions on iPad', async () => {
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
      data.personAIHistory=async()=>({ok:true,generated:[],legacy:[]});
      window.pc33={summaryCalls:0,prepCalls:0};
      data.summarizePerson=async()=>{window.pc33.summaryCalls++;return await new Promise((resolve,reject)=>{window.pc33.summaryResolve=resolve;window.pc33.summaryReject=reject;});};
      data.meetingPrep=async()=>{window.pc33.prepCalls++;return await new Promise((resolve,reject)=>{window.pc33.prepResolve=resolve;window.pc33.prepReject=reject;});};
      window.pc33I18n=i18n;
      window.pc33Render=()=>renderPerson({main:document.querySelector('.console-main'),api:{call:async()=>({})},toast:()=>{}},'783');
      window.pc33Render();
    })()`);
    await browser.wait("[...document.querySelectorAll('.console-main button')].some(x=>x.textContent.trim()==='AI 摘要')");
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].filter(x=>x.textContent.trim()==='AI 摘要').forEach(x=>{x.click();x.click()})");
    assert.equal(await browser.evaluate('window.pc33.summaryCalls'),1);
    await browser.evaluate("window.pc33.summaryReject(new Error('AI_AUDIT_UNKNOWN: uncertain'))");
    await browser.wait("document.querySelector('.summary-card')?.innerText.includes('审计状态尚未核实')");
    assert.match(await browser.evaluate("document.querySelector('.summary-card').innerText"),/查看历史/);
    await browser.evaluate("window.pc33I18n.setLang('en');window.pc33Render()");
    await browser.wait("[...document.querySelectorAll('.console-main button')].some(x=>x.textContent.trim()==='Prep')");
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].filter(x=>x.textContent.trim()==='Prep').forEach(x=>{x.click();x.click()})");
    assert.equal(await browser.evaluate('window.pc33.prepCalls'),1);
    await browser.evaluate("window.pc33.prepReject(new Error('TIMEOUT: uncertain'))");
    await browser.wait("[...document.querySelectorAll('.summary-card')].some(x=>x.innerText.includes('remote completion is uncertain'))");
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
