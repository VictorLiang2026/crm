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
      data.meetingPrepStatus=async()=>({ok:true,status:'none'});
      window.pc33={summaryCalls:0,prepCalls:0};
      data.summarizePerson=async()=>{window.pc33.summaryCalls++;return await new Promise((resolve,reject)=>{window.pc33.summaryResolve=resolve;window.pc33.summaryReject=reject;});};
      data.meetingPrep=async()=>{window.pc33.prepCalls++;return await new Promise((resolve,reject)=>{window.pc33.prepResolve=resolve;window.pc33.prepReject=reject;});};
      window.pc33I18n=i18n;
      window.pc33Render=()=>renderPerson({main:document.querySelector('.console-main'),api:{call:async()=>({})},toast:()=>{}},'783','ai');
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
    await browser.wait("[...document.querySelectorAll('.summary-card')].some(x=>x.innerText.includes('No meeting prep result is available yet'))");
    assert.equal(await browser.evaluate('window.pc33.prepCalls'),0,'opening meeting prep only reads existing results');
    await browser.evaluate("[...document.querySelectorAll('.summary-card button')].find(x=>x.textContent.trim()==='Generate').click();[...document.querySelectorAll('.summary-card button')].find(x=>x.textContent.trim()==='Generate')?.click()");
    assert.equal(await browser.evaluate('window.pc33.prepCalls'),1);
    await browser.evaluate("window.pc33.prepReject(new Error('TIMEOUT: uncertain'))");
    await browser.wait("[...document.querySelectorAll('.summary-card')].some(x=>x.innerText.includes('timed out without a result'))");
    await browser.evaluate(`(async()=>{
      const {data}=await import('/crm/js/modules/console/data.js');
      data.meetingPrepStatus=async()=>({ok:false,status:'failed',error:{code:'TIMEOUT'}});
      data.personAIHistory=async()=>({ok:true,generated:[{id:'72',taskType:'meeting_prep',createdAt:'2026-11-05',result:{brief30Seconds:'Existing meeting brief',recentChanges:['Recent change'],suggestedObjective:'Confirm needs'},sources:[]}],legacy:[]});
      window.pc33Render();
    })()`);
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].find(x=>x.textContent.trim()==='Prep').click()");
    await browser.wait("[...document.querySelectorAll('.summary-card')].some(x=>x.innerText.includes('Existing meeting brief'))");
    assert.equal(await browser.evaluate('window.pc33.prepCalls'),1,'reading previous prep does not regenerate it');
    assert.match(await browser.evaluate("[...document.querySelectorAll('.summary-card')].find(x=>x.innerText.includes('Existing meeting brief')).innerText"),/Regenerate/);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const layout = await browser.evaluate(`(()=>{
        const row=document.querySelector('.meeting-prep-panel .ai-history-row');
        if(!row)return null;
        const boxes=[...row.children].map(el=>el.getBoundingClientRect());
        return {direction:getComputedStyle(row).flexDirection,vertical:boxes.every((box,i)=>!i||box.top>=boxes[i-1].bottom-1),aligned:boxes.every(box=>Math.abs(box.left-boxes[0].left)<=1&&Math.abs(box.width-boxes[0].width)<=1)};
      })()`);
      assert.deepEqual(layout,{direction:'column',vertical:true,aligned:true},`${width}x${height} prep result layout`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
