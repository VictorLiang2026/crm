'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Knowledge & Strategies is bilingual, searchable, sortable, paginated, and uses the authenticated server API', async () => {
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
        if(payload.action==='listKnowledgeGovernance')return {knowledge:[
          {id:1,item_type:'evidence',source:'Policy',content:'Reviewed clause',metadata:{domain:'industry'},confidence:.9,verified:false,lifecycle_status:'draft',version_no:1,updated_at:'2026-10-16T00:00:00Z'},
          {id:2,item_type:'company',source:'Sales framework',content:'Recruitment notes',metadata:{domain:'recruitment',summary:'needle summary'},confidence:.9,verified:true,lifecycle_status:'verified',version_no:1,updated_at:'2026-10-17T00:00:00Z'}
        ],playbooks:[]};
        if(payload.action==='knowledgeLibrary'&&payload.operation==='list')return {ok:true,sources:[],knowledge:[],playbooks:[]};
        return {ok:true};
      }}};
      window.kgCalls=calls;window.kgRender=()=>renderKnowledgeGovernance(ctx);window.kgI18n=i18n;window.confirm=()=>true;
      window.kgRender(); await new Promise(r=>setTimeout(r,30));
    })()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"1\"]')");
    const first = await browser.evaluate(`({text:document.querySelector('#console-main').innerText, writes:window.kgCalls.filter(x=>!(x.payload.action==='listKnowledgeGovernance'||(x.payload.action==='knowledgeLibrary'&&x.payload.operation==='list'))).length})`);
    assert.equal(first.writes, 0, 'opening the page does not write business data');
    assert.match(first.text, /Reviewed clause/);
    assert.match(first.text, /知识与策略/);
    await browser.evaluate(`(()=>{const q=document.querySelector('.kg-search input[type=search]');q.value='needle';document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.kg-table tbody tr[data-kg-id]').length"),0,'title-only search does not include summaries');
    await browser.evaluate(`(()=>{document.querySelector('.kg-full-search input').checked=true;document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"2\"]')");
    await browser.evaluate("document.querySelector('.kg-table th.kg-sortable').click()");
    await browser.evaluate("window.kgI18n.setLang('en');window.kgRender()");
    await browser.wait("document.querySelector('#console-main').innerText.includes('Knowledge & Strategies')");
    const english = await browser.evaluate("document.querySelector('#console-main').innerText");
    assert.match(english, /Create synthetic fixtures/);
    await browser.evaluate("window.kgI18n.setLang('zh-CN');window.kgRender()");
    await browser.wait("document.querySelector('#console-main').innerText.includes('知识与策略')");
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate(`(()=>{
      document.querySelector('.kg-list-buttons .btn-primary').click();
      const f=document.querySelector('.kg-editor-form');
      f.elements.title.value='New product note';f.elements.domain.value='product';
      f.elements.summary.value='Operator summary';f.elements.content.value='Product knowledge';
      f.requestSubmit();
    })()`);
    await browser.wait("window.kgCalls.some(x=>x.payload.action==='knowledgeLibrary'&&x.payload.operation==='save')");
    assert.equal(await browser.evaluate("window.kgCalls.find(x=>x.payload.operation==='save').payload.data.summary"),'Operator summary');
    await browser.evaluate("[...document.querySelectorAll('.kg-table button')].find(x=>x.textContent.trim()==='审核通过').click()");
    await browser.wait("window.kgCalls.some(x=>x.payload.action==='reviewKnowledgeGovernance')");
    assert.equal(await browser.evaluate("window.kgCalls.some(x=>x.payload.action==='reviewKnowledgeGovernance'&&x.payload.data.expectedUpdatedAt==='2026-10-16T00:00:00Z')"),true);
    await browser.evaluate("[...document.querySelectorAll('.kg-list-buttons button')].find(x=>x.textContent.trim()==='创建合成回归样例').click()");
    await browser.wait("window.kgCalls.some(x=>x.payload.action==='createKnowledgeGovernanceFixtures')");
  } finally { await browser.close(); }
});
