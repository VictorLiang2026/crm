'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC22 governance page is bilingual, iPad-safe, and uses the authenticated server API', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      const calls=[];
      const ctx={main:document.querySelector('.console-main'),api:{call:async(name,payload)=>{
        calls.push({name,payload});
        if(payload.action==='listKnowledgeGovernance')return {knowledge:[{id:1,item_type:'evidence',source:'Policy',content:'Reviewed clause',confidence:.9,verified:false,lifecycle_status:'draft',version_no:1,updated_at:'2026-10-16T00:00:00Z'}],playbooks:[]};
        return {ok:true};
      }}};
      window.kgCalls=calls;window.kgRender=()=>renderKnowledgeGovernance(ctx);window.kgI18n=i18n;window.confirm=()=>true;
      window.kgRender(); await new Promise(r=>setTimeout(r,30));
    })()`);
    await browser.wait("document.querySelector('.kg-layout .kg-row')");
    const first = await browser.evaluate(`({text:document.querySelector('#console-main').innerText, writes:window.kgCalls.filter(x=>!['listKnowledgeGovernance'].includes(x.payload.action)).length})`);
    assert.equal(first.writes, 0, 'opening the page does not write business data');
    assert.match(first.text, /Reviewed clause/);
    await browser.evaluate("window.kgI18n.setLang('en');window.kgRender()");
    await browser.wait("document.querySelector('#console-main').innerText.includes('Knowledge & Strategy Governance')");
    const english = await browser.evaluate("document.querySelector('#console-main').innerText");
    assert.match(english, /Create synthetic fixtures/);
    await browser.evaluate("window.kgI18n.setLang('zh-CN');window.kgRender()");
    await browser.wait("document.querySelector('#console-main').innerText.includes('知识与策略治理')");
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate("[...document.querySelectorAll('.kg-row button')].find(x=>x.textContent.trim()==='审核通过').click()");
    await browser.wait("window.kgCalls.some(x=>x.payload.action==='reviewKnowledgeGovernance')");
    assert.equal(await browser.evaluate("window.kgCalls.some(x=>x.payload.action==='reviewKnowledgeGovernance'&&x.payload.data.expectedUpdatedAt==='2026-10-16T00:00:00Z')"),true);
    await browser.evaluate("[...document.querySelectorAll('.kg-toolbar button')].find(x=>x.textContent.trim()==='创建合成回归样例').click()");
    await browser.wait("window.kgCalls.some(x=>x.payload.action==='createKnowledgeGovernanceFixtures')");
  } finally { await browser.close(); }
});
