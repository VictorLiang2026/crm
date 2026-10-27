'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Knowledge Library supports categories, bilingual search, sorting, status, and CRUD routes', async () => {
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
        if(name==='assistant'&&payload.action==='knowledgeLibrary'&&payload.operation==='list')return {ok:true,sources:[],knowledge:[
          {id:1,item_type:'evidence',source:'Policy',content:'Reviewed clause',metadata:{categories:['industry_development'],summary:'industry summary'},confidence:.9,verified:false,lifecycle_status:'draft',version_no:1,updated_at:'2026-10-16T00:00:00Z'},
          {id:2,item_type:'company',source:'Sales framework',content:'Recruitment notes',metadata:{categories:['recruitment_policy'],summary:'needle summary'},confidence:.9,verified:true,lifecycle_status:'verified',version_no:1,updated_at:'2026-10-17T00:00:00Z'}
        ],playbooks:[]};
        return {ok:true};
      }}};
      window.kgCalls=calls;window.kgRender=()=>renderKnowledgeGovernance(ctx);window.kgI18n=i18n;
      window.confirm=()=>true;window.kgRender();
    })()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"1\"]')");
    const first = await browser.evaluate(`({text:document.querySelector('.console-main').innerText,
      writes:window.kgCalls.filter(x=>x.payload.operation!=='list').length,
      types:document.querySelectorAll('.kg-type-filter').length})`);
    assert.equal(first.writes, 0, 'opening the page does not write business data');
    assert.match(first.text, /知识与策略/);
    assert.equal(first.types,0,'the type filter is removed');
    await browser.evaluate(`(()=>{const q=document.querySelector('.kg-search input[type="search"]');q.value='needle';document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.kg-table tbody tr[data-kg-id]').length"),0,'default search uses titles only');
    await browser.evaluate(`(()=>{document.querySelector('.kg-full-search input').checked=true;document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"2\"]')");
    await browser.evaluate("document.querySelector('.kg-table th.kg-sortable').click()");
    await browser.evaluate("window.kgI18n.setLang('en');window.kgRender()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('Knowledge & Strategies')");
    assert.match(await browser.evaluate("document.querySelector('.console-main').innerText"), /Upload and Create Knowledge/);
    await browser.evaluate("window.kgI18n.setLang('zh-CN');window.kgRender()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('知识与策略')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.head-actions a')].filter(a=>['#/knowledge/upload','#/knowledge/new','#/knowledge/playbook'].includes(a.getAttribute('href'))).length"),3);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
