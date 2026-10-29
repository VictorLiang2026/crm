'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person objection response and citations are collapsed until requested in both languages', async () => {
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
      data.personAIHistory=async()=>({ok:true,generated:[],legacy:[]});
      data.conversationPlaybookHistory=async()=>({ok:true,hasResult:true,objection:'【系统测试·勿联系】保费太贵，想再考虑',
        possibleUnderlyingReasons:['【系统测试·勿联系】预算压力待确认'],clarifyingQuestions:['【系统测试·勿联系】可接受的预算范围是什么？'],
        responseLogic:'【系统测试·勿联系】先了解保障重点与预算，再比较方案。',nextObjective:'【系统测试·勿联系】确认优先保障项目',
        doNotSay:['【系统测试·勿联系】不承诺收益'],evidenceSources:[{schema:'public',table:'knowledge_items',id:'11',label:'虚构知识引用'}],taskId:'fixture'});
      window.pc37I18n=i18n;
      window.pc37Render=()=>renderPerson({main:document.querySelector('.console-main'),api:{call:async()=>({})},toast:()=>{}},'783');
      window.pc37Render();
    })()`);
    await browser.wait("document.querySelector('.summary-card details.playbook-response-details')?.querySelector('summary')");
    const collapsed = await browser.evaluate(`(()=>{const panel=[...document.querySelectorAll('.summary-card')].find(x=>x.querySelector('.playbook-response-details'));const d=panel.querySelector('details'),body=d.querySelector('.playbook-response-body');return {question:panel.innerText.includes('保费太贵，想再考虑'),open:d.open,summary:d.querySelector('summary').innerText,bodyHeight:body.getBoundingClientRect().height,bodyDisplay:getComputedStyle(body).display,bodyVisibility:getComputedStyle(body).visibility,sourceVisible:[...d.querySelectorAll('a')].some(a=>a.getClientRects().length>0)}})()`);
    assert.equal(collapsed.question, true);
    assert.equal(collapsed.open, false);
    assert.equal(collapsed.summary, '查看正文与引用');
    assert.equal(collapsed.bodyHeight, 0);
    assert.equal(collapsed.sourceVisible, false);

    await browser.evaluate("document.querySelector('.playbook-response-details summary').click()");
    await browser.wait("document.querySelector('.playbook-response-details')?.open===true");
    const expanded = await browser.evaluate(`(()=>{const d=document.querySelector('.playbook-response-details');return {response:d.innerText.includes('先了解保障重点'),reason:d.innerText.includes('预算压力待确认'),citation:d.innerText.includes('虚构知识引用'),sourceVisible:[...d.querySelectorAll('a')].some(a=>a.getClientRects().length>0)}})()`);
    assert.deepEqual(expanded, { response: true, reason: true, citation: true, sourceVisible: true });
    await browser.evaluate("document.querySelector('.playbook-response-details summary').click()");
    await browser.wait("document.querySelector('.playbook-response-details')?.open===false");

    await browser.evaluate("window.pc37I18n.setLang('en');window.pc37Render()");
    await browser.wait("document.querySelector('.playbook-response-details summary')?.innerText==='View content and references'");
    assert.equal(await browser.evaluate("document.querySelector('.playbook-response-details')?.open"), false);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.summary-card')].find(x=>x.querySelector('.playbook-response-details')).innerText.includes('Customer Objection')"), true);
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, `${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.healthy();
    assert.deepEqual(browser.networkViolations, []);
  } finally { await browser.close(); }
});
