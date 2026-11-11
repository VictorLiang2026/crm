'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('action routes and explicitly confirmed candidate link work in both languages and three layouts', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more','authCase=1');
    await browser.wait("document.querySelector('.more-primary a[href=\"#/actions\"]')");
    await browser.evaluate(`(async()=>{
      const {dispatch}=await import('/crm/js/modules/console/router.js');
      const {actionContextPanel}=await import('/crm/js/modules/console/action-center.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const main=document.querySelector('.console-main');
      const row={id:42,kind:'action',person_id:13,person_name:'Test Person',title:'Test Call',status:'open',due_at:'2026-11-10T16:30:00Z'};
      let linked=false;
      const ctx={main,toast(){},api:{async call(name,{action,query,data}){
        if(name!=='person_360')throw Error(name);
        if(action==='listActionCenter'){
          const rows=query.view==='linked'&&!linked?[]:[row];
          return {rows,total:rows.length,page:1,personId:13,personName:'Test Person'};
        }
        if(action==='previewActionContext'){
          if(data.operation!=='link'||data.actionId!==42||data.kind!=='candidate'||data.targetId!==9)throw Error('Unexpected link');
          return {previewId:'verified-preview',preview:{...data,personName:row.person_name,title:row.title,dueAt:row.due_at,status:row.status}};
        }
        if(action==='confirmActionContext'&&data.previewId==='verified-preview'){linked=true;return {actionId:42};}
        throw Error(action);
      }}};
      window.acTest={route:key=>dispatch('#/actions/'+key,ctx),setLang,linked:()=>linked,
        panel:()=>main.replaceChildren(actionContextPanel(ctx,{kind:'candidate',targetId:9},null,{next_action_date:'2026-12-05'}))};
    })()`);
    for(const lang of ['zh-CN','en']){
      await browser.evaluate(`acTest.setLang('${lang}')`);
      for(const view of ['today','week','overdue','waiting','completed','42']){
        await browser.evaluate(`acTest.route('${view}')`);
        await browser.wait("document.querySelector('.console-main [data-action-id=\"42\"]')");
        assert.equal(await browser.evaluate("document.querySelector('.console-main [aria-pressed=true]')?.dataset.view||''"),view==='42'?'':view);
        assert.match(await browser.evaluate("document.querySelector('.console-main').innerText"),/2026-11-11/);
      }
      for(const [width,height,mobile] of [[390,844,true],[844,390,true],[820,1180,false],[1180,820,false],[1440,900,false]]){
        await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
        assert.ok(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.console-main').scrollWidth<=document.querySelector('.console-main').clientWidth+1"),lang+' '+width);
      }
    }
    await browser.evaluate("acTest.panel()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('2026-12-05')");
    await browser.evaluate("document.querySelector('.console-main .toolbar button:last-child').click()");
    await browser.wait("[...document.querySelectorAll('.sheet button')].some(b=>b.innerText.includes('Test Call'))");
    await browser.evaluate("[...document.querySelectorAll('.sheet button')].find(b=>b.innerText.includes('Test Call')).click()");
    await browser.wait("document.querySelector('.sheet-preview .btn-primary')");
    assert.equal(await browser.evaluate("acTest.linked()"),false);
    await browser.evaluate("document.querySelector('.sheet-preview .btn-primary').click()");
    await browser.wait("acTest.linked() && document.querySelector('.console-main [data-action-id=\"42\"]')");
    assert.ok(!(await browser.evaluate("document.querySelector('.console-main').innerText")).includes('2026-12-05'));
    await browser.healthy();
  } finally { await browser.close(); }
});
