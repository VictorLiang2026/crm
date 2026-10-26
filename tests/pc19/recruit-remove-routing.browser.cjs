'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('candidate removal routes Person-only records through Person 360 and keeps customer-linked flow', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {openRecruitCandidateRemove}=await import('/crm/js/modules/console/write.js');
      window.removeRouting={calls:[]};
      const ctx={api:{call:async(name,args)=>{window.removeRouting.calls.push({name,args});return {ok:true};}},toast:()=>{}};
      openRecruitCandidateRemove(ctx,{candidate:{id:'580',customer_id:null},onDone:()=>{}});
    })()`);
    await browser.wait("document.querySelector('.sheet-overlay .sheet-actions .btn-primary')");
    await browser.click('.sheet-overlay .sheet-actions .btn-primary', '移除候选人');
    await browser.wait('window.removeRouting.calls.length===1');
    await browser.evaluate(`(async()=>{
      const {openRecruitCandidateRemove}=await import('/crm/js/modules/console/write.js');
      const ctx={api:{call:async(name,args)=>{window.removeRouting.calls.push({name,args});return {ok:true};}},toast:()=>{}};
      openRecruitCandidateRemove(ctx,{candidate:{id:'581',customer_id:42},onDone:()=>{}});
    })()`);
    await browser.wait("document.querySelector('.sheet-overlay .sheet-actions .btn-primary')");
    await browser.click('.sheet-overlay .sheet-actions .btn-primary', '移除候选人');
    await browser.wait('window.removeRouting.calls.length===2');
    const calls = await browser.evaluate('window.removeRouting.calls');
    assert.deepEqual(calls, [
      { name: 'person_360', args: { action: 'removePersonOnlyRecruit', id: '580' } },
      { name: 'recruit_candidates', args: { action: 'remove', id: 581 } },
    ]);
    await browser.healthy();
  } finally { await browser.close(); }
});
