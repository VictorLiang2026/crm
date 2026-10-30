'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('legacy interaction forms remain callable after unified launcher migration', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/person/980001');
    await browser.wait("document.querySelectorAll('.tab').length>=8");
    await browser.click('.tab', '互动时间线');
    await browser.wait("document.querySelectorAll('.tab-stack').length>0");
    const timelineReady = await browser.evaluate("({text:document.getElementById('app')?.innerText, buttons:[...document.querySelectorAll('.tab-stack button')].map(button=>button.textContent), calls:window.__crmTest.calls, errors:window.__crmTest.errors})");
    assert.ok(timelineReady.buttons.includes('记录互动'), JSON.stringify(timelineReady));

    await browser.evaluate(`window.__legacyCtx={api:{call:async(name,data)=>(await cloudbase.init().callFunction({name,data})).result},toast:()=>{}};window.__legacyDone=()=>{window.dispatchEvent(new HashChangeEvent('hashchange'));setTimeout(()=>document.querySelectorAll('.tab')[1]?.click(),100)};import('/crm/js/modules/console/write.js').then(m=>m.openPersonInteraction(window.__legacyCtx,{personId:'980001',onDone:window.__legacyDone}));`);
    await browser.wait("document.querySelector('.sheet input[type=datetime-local]')");
    await browser.evaluate(`(() => {
      const sheet=document.querySelector('.sheet');
      sheet.querySelector('input[type="datetime-local"]').value='2026-10-15T23:55';
      const areas=sheet.querySelectorAll('textarea');
      areas[0].value='[CRM_TEST_ONLY]午夜前后的人工沟通';
      areas[1].value='[CRM_TEST_ONLY]已确认次日继续联系';
      const save=[...sheet.querySelectorAll('button')].find(button=>button.textContent.includes('保存'));
      save.click(); save.click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='createInteraction')");
    await new Promise(resolve => setTimeout(resolve, 300));
    const afterInteraction = await browser.evaluate("({app:document.getElementById('app')?.innerText, calls:window.__crmTest.calls, errors:window.__crmTest.errors, rows:[...document.querySelectorAll('.tl-item')].map(row=>row.innerText)})");
    assert.ok(afterInteraction.rows.some(row=>row.includes('[CRM_TEST_ONLY]午夜前后的人工沟通')), JSON.stringify(afterInteraction));
    const interaction = await browser.evaluate(`(() => {
      const writes=window.__crmTest.calls.filter(call=>call.action==='createInteraction');
      return {count:writes.length,payload:writes[0]?.payload};
    })()`);
    assert.equal(interaction.count, 1, 'double click submits only once');
    assert.equal(interaction.payload.interaction_at, await browser.evaluate("new Date('2026-10-15T23:55').toISOString()"));
    assert.equal(interaction.payload.summary, '[CRM_TEST_ONLY]午夜前后的人工沟通');

    // Preload the activity-linked tab so the follow-up must invalidate its cached view.
    await browser.click('.tab', '活动');
    await browser.wait("document.querySelectorAll('.tab-stack').length>0");
    await browser.click('.tab', '互动时间线');
    await browser.wait("[...document.querySelectorAll('.tab-stack button')].some(button=>button.textContent.includes('记录互动'))");
    await browser.evaluate(`import('/crm/js/modules/console/write.js').then(m=>m.openPersonFollowup(window.__legacyCtx,{personId:'980001',customerId:'910001',onDone:window.__legacyDone}));`);
    await browser.wait("document.querySelector('.sheet input[type=date]')");
    // iPad portrait and landscape: keep the write sheet within the viewport.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: false });
    let viewport = await browser.evaluate("({width:innerWidth,doc:document.documentElement.scrollWidth,sheet:document.querySelector('.sheet')?.getBoundingClientRect().width,client:document.querySelector('.sheet')?.clientWidth,scroll:document.querySelector('.sheet')?.scrollWidth})");
    assert.equal(viewport.width, 820);
    assert.ok(viewport.doc <= viewport.width, JSON.stringify(viewport));
    assert.ok(viewport.scroll <= viewport.client, JSON.stringify(viewport));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 2, mobile: false });
    viewport = await browser.evaluate("({width:innerWidth,doc:document.documentElement.scrollWidth,sheet:document.querySelector('.sheet')?.getBoundingClientRect().width,client:document.querySelector('.sheet')?.clientWidth,scroll:document.querySelector('.sheet')?.scrollWidth})");
    assert.equal(viewport.width, 1180);
    assert.ok(viewport.doc <= viewport.width, JSON.stringify(viewport));
    assert.ok(viewport.scroll <= viewport.client, JSON.stringify(viewport));
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate(`(() => {
      const sheet=document.querySelector('.sheet');
      const dates=sheet.querySelectorAll('input[type="date"]'); dates[0].value='2026-10-16';
      const areas=sheet.querySelectorAll('textarea');
      areas[0].value='[CRM_TEST_ONLY]客户反馈摘要';
      areas[1].value='[CRM_TEST_ONLY]完整跟进原文';
      const select=sheet.querySelector('select'); select.value='932001';
      sheet.querySelector('input[type="number"]').value='940001';
      sheet.querySelectorAll('input[type="date"]')[1].value='2026-10-20';
      const textInputs=sheet.querySelectorAll('input:not([type])');
      textInputs[0].value='[CRM_TEST_ONLY]整理家庭保障资料';
      sheet.querySelectorAll('input[type="date"]')[2].value='2026-10-21';
      const save=[...sheet.querySelectorAll('button')].find(button=>button.textContent.includes('保存'));
      save.click(); save.click();
    })()`);
    await browser.wait("[...document.querySelectorAll('.tl-item')].some(row=>row.innerText.includes('public.followups#920002'))");
    const create = await browser.evaluate("window.__crmTest.calls.find(call=>call.name==='followups'&&call.action==='create')");
    assert.ok(create);
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='followups'&&call.action==='create').length"), 1,
      'double click creates one follow-up');
    assert.equal(create.payload.recommendation_id, 932001);
    assert.equal(create.payload.activity_id, 940001);
    assert.equal(create.payload.next_followup_date, '2026-10-20');
    assert.equal(create.payload.next_action_date, '2026-10-21');
    assert.equal(create.payload.customer_id, 910001);

    await browser.click('.tab', '活动');
    await new Promise(resolve => setTimeout(resolve, 300));
    const activityState = await browser.evaluate("({text:document.getElementById('app')?.innerText,calls:window.__crmTest.calls.filter(call=>call.action==='getTimelinePage'),tabs:[...document.querySelectorAll('.tab')].map(tab=>[tab.textContent,tab.classList.contains('active')])})");
    assert.ok(activityState.text.includes('[CRM_TEST_ONLY]客户反馈摘要'), JSON.stringify(activityState));
    await browser.click('.tab', '互动时间线');
    await browser.wait("[...document.querySelectorAll('.tl-item')].some(row=>row.innerText.includes('public.followups#920002'))");
    await browser.evaluate(`(() => {
      const row=[...document.querySelectorAll('.tl-item')].find(item=>item.innerText.includes('public.followups#920002'));
      row.querySelector('button').click();
    })()`);
    await browser.wait("document.querySelector('.sheet input[type=date]')");
    await browser.evaluate(`(() => {
      const sheet=document.querySelector('.sheet');
      sheet.querySelectorAll('input[type="date"]')[0].value='2026-10-17';
      [...sheet.querySelectorAll('button')].find(button=>button.textContent.includes('保存')).click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='followups'&&call.action==='update')");
    const update = await browser.evaluate("window.__crmTest.calls.find(call=>call.name==='followups'&&call.action==='update')");
    assert.ok(update);
    assert.equal(update.id, 920002);
    assert.equal(update.payload.recommendation_id, 932001, 'recommendation link survives edit');
    assert.equal(update.payload.activity_id, 940001, 'activity link survives edit');
    assert.equal(update.payload.followup_notes, '[CRM_TEST_ONLY]完整跟进原文');

    await browser.evaluate(`(() => {
      const row=[...document.querySelectorAll('.tl-item')].find(item=>item.innerText.includes('public.followups#920002'));
      row.querySelector('button').click();
    })()`);
    await browser.wait("[...document.querySelectorAll('.sheet button')].some(button=>button.textContent.includes('永久删除跟进'))");
    await browser.click('.sheet button', '永久删除跟进');
    await browser.wait("document.querySelector('.sheet')?.innerText.includes('永久删除此记录')");
    await browser.click('.sheet button', '永久删除跟进');
    await browser.wait("![...document.querySelectorAll('.tl-item')].some(row=>row.innerText.includes('public.followups#920002'))");
    const removed = await browser.evaluate("window.__crmTest.calls.find(call=>call.name==='followups'&&call.action==='remove')");
    assert.equal(removed.id, 920002);

    await browser.evaluate("location.hash='#/today'");
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='person_360'&&call.action==='listTodayWorkItems')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.some(call=>call.name==='person_360'&&call.action==='listTodayWorkItems')"), true);
    await browser.evaluate("localStorage.setItem('crm_lang','en'); location.reload()");
    await browser.wait("window.__crmTest && document.getElementById('app')?.innerText.includes('Today')");
    await browser.evaluate("location.hash='#/person/980001'");
    await browser.wait("location.hash==='#/person/980001' && document.querySelectorAll('.tab').length>=8");
    await browser.evaluate("document.querySelectorAll('.tab')[1]?.click()");
    await browser.wait("document.querySelectorAll('.tab-stack').length>0");
    const english = await browser.evaluate("[...document.querySelectorAll('.tab-stack button')].map(button=>button.textContent)");
    assert.ok(english.includes('Record interaction'), JSON.stringify(english));
    assert.equal(english.includes('Add Customer Follow-up'), false);
    await browser.healthy();
  } finally { await browser.close(); }
});
