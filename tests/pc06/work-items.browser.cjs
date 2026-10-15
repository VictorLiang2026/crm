'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC06 Person and Today share preview-confirmed Action and Commitment operations', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/person/980001');
    await browser.wait("document.querySelectorAll('.tab').length>=8");
    await browser.click('.tab', '机会与行动');
    await browser.wait("[...document.querySelectorAll('.tab-stack button')].some(button=>button.textContent.includes('新建行动'))");

    const personView = await browser.evaluate("({text:[...document.querySelectorAll('.tab-stack')].map(node=>node.innerText).join('\\n'),workCalls:window.__crmTest.calls.filter(call=>call.action==='listPersonWorkItems').length})");
    assert.ok(personView.text.includes('整理反馈'), JSON.stringify(personView));
    assert.ok(personView.text.includes('核对资料'), JSON.stringify(personView));

    await browser.click('.tab-stack button', '新建行动');
    await browser.wait("document.querySelector('.sheet input:not([type=search])')");
    await browser.evaluate(`(() => {
      const sheet=document.querySelector('.sheet');
      sheet.querySelector('input:not([type=search])').value='[CRM_TEST_ONLY]PC06新建行动';
      sheet.querySelector('textarea').value='[CRM_TEST_ONLY]先确认结果';
      sheet.querySelector('select').value='high';
      sheet.querySelector('input[type=datetime-local]').value='2026-10-18T14:30';
    })()`);
    await browser.click('.sheet button', '生成预览');
    await browser.wait("document.querySelector('.sheet-preview')?.innerText.includes('PC06新建行动')");
    const createPreviewText = await browser.evaluate("document.querySelector('.sheet-preview')?.innerText");
    assert.ok(createPreviewText.includes('980001') && createPreviewText.includes('执行时服务端会再次核验'), createPreviewText);
    const beforeConfirm = await browser.evaluate("({exec:window.__crmTest.calls.filter(call=>call.action==='executeWorkItem').length, preview:window.__crmTest.calls.filter(call=>call.action==='previewWorkItem').at(-1)?.payload})");
    assert.equal(beforeConfirm.exec, 0, 'no write before confirmation');
    assert.equal(beforeConfirm.preview.kind, 'action');
    assert.equal(beforeConfirm.preview.operation, 'create');
    assert.equal(beforeConfirm.preview.draft.priority, 'high');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: false });
    let viewport = await browser.evaluate("({width:innerWidth,doc:document.documentElement.scrollWidth,client:document.querySelector('.sheet')?.clientWidth,scroll:document.querySelector('.sheet')?.scrollWidth})");
    assert.ok(viewport.doc <= viewport.width && viewport.scroll <= viewport.client, JSON.stringify(viewport));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 2, mobile: false });
    viewport = await browser.evaluate("({width:innerWidth,doc:document.documentElement.scrollWidth,client:document.querySelector('.sheet')?.clientWidth,scroll:document.querySelector('.sheet')?.scrollWidth})");
    assert.ok(viewport.doc <= viewport.width && viewport.scroll <= viewport.client, JSON.stringify(viewport));
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='executeWorkItem')");
    await browser.click('.tab', '机会与行动');
    await new Promise(resolve => setTimeout(resolve, 300));
    const afterCreate = await browser.evaluate("({text:[...document.querySelectorAll('.tab-stack')].map(node=>node.innerText).join('\\n'),items:window.__crmTest.getWorkItems(),calls:window.__crmTest.calls.filter(call=>['listPersonWorkItems','executeWorkItem'].includes(call.action)),errors:window.__crmTest.errors})");
    assert.ok(afterCreate.items.some(row=>row.title?.includes('PC06新建行动')), JSON.stringify(afterCreate));
    assert.ok(afterCreate.text?.includes('PC06新建行动'), JSON.stringify(afterCreate));

    await browser.evaluate(`(() => {
      const row=[...document.querySelectorAll('.list-row')].find(node=>node.innerText.includes('PC06新建行动'));
      row.querySelector('button').click();
    })()`);
    await browser.wait("document.querySelector('.sheet input:not([type=search])')");
    await browser.evaluate(`(() => {
      document.querySelector('.sheet input:not([type=search])').value='[CRM_TEST_ONLY]PC06行动已编辑';
      document.querySelector('.sheet textarea').value='[CRM_TEST_ONLY]更新说明';
    })()`);
    await browser.click('.sheet button', '生成预览');
    await browser.wait("document.querySelector('.sheet-preview')?.innerText.includes('PC06行动已编辑')");
    const editPreviewText = await browser.evaluate("document.querySelector('.sheet-preview')?.innerText");
    assert.ok(editPreviewText.includes('PC06新建行动') && editPreviewText.includes('PC06行动已编辑'), editPreviewText);
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem').length"), 1);
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("[...document.querySelectorAll('.tab-stack')].some(node=>node.innerText.includes('PC06行动已编辑'))");

    await browser.evaluate(`(() => {
      const row=[...document.querySelectorAll('.list-row')].find(node=>node.innerText.includes('PC06行动已编辑'));
      [...row.querySelectorAll('button')].find(button=>button.textContent.includes('完成')).click();
    })()`);
    await browser.evaluate("window.__crmTest.rejectWorkItemExecuteOnce=true");
    await browser.click('.sheet button', '生成预览');
    await browser.wait("document.querySelector('.sheet-preview')?.innerText.includes('已完成')");
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("document.querySelector('.sheet')?.innerText.includes('条目状态已变化')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length"), 2,
      'a stale version is not treated as completed');
    await browser.click('.sheet button', '生成预览');
    await browser.wait("window.__crmTest.calls.filter(call=>call.action==='previewWorkItem').length===4");
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("[...document.querySelectorAll('.toast')].some(node=>node.innerText.includes('补记本次结果'))");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length"), 3);

    await browser.click('.tab', '机会与行动');
    const commitmentRows = await browser.evaluate("({active:document.querySelector('.tab.active')?.textContent,rows:[...document.querySelectorAll('.list-row')].filter(node=>node.innerText.includes('核对资料')).map(node=>({text:node.innerText,buttons:[...node.querySelectorAll('button')].map(button=>button.textContent)}))})");
    assert.ok(commitmentRows.rows.some(row=>row.buttons.some(button=>button.includes('撤销'))), JSON.stringify(commitmentRows));
    await browser.evaluate(`(() => {
      const details=[...document.querySelectorAll('details')].find(node=>node.innerText.includes('最近结束'));
      if(details&&!details.open) details.querySelector('summary').click();
      const row=[...document.querySelectorAll('.list-row')].find(node=>node.innerText.includes('PC06行动已编辑'));
      [...row.querySelectorAll('button')].find(button=>button.textContent.includes('重新打开')).click();
    })()`);
    await browser.click('.sheet button', '生成预览');
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='previewWorkItem'&&call.operation==='reopen')");
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length===4");

    await browser.evaluate("location.hash='#/today'");
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='listTodayWorkItems')");
    await browser.wait("document.getElementById('app')?.innerText.includes('核对资料')");
    const today = await browser.evaluate("({text:document.getElementById('app')?.innerText,legacyDue:window.__crmTest.calls.some(call=>call.action==='listDueCommitments'),workCalls:window.__crmTest.calls.filter(call=>call.action==='listTodayWorkItems').length})");
    assert.ok(today.text.includes('我承诺') || today.text.includes('对方承诺'), JSON.stringify(today));
    assert.equal(today.legacyDue, false, 'Today commitments use the canonical work item read');
    await browser.evaluate(`(() => {
      const row=[...document.querySelectorAll('.list-row')].find(node=>node.innerText.includes('核对资料'));
      [...row.querySelectorAll('button')].find(button=>button.textContent.includes('撤销')).click();
    })()`);
    await browser.click('.sheet button', '生成预览');
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='previewWorkItem'&&call.operation==='cancel')");
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length===5");
    await browser.evaluate(`(() => {
      const details=[...document.querySelectorAll('details')].find(node=>node.textContent.includes('核对资料'));
      if(details&&!details.open) details.querySelector('summary').click();
      const row=[...document.querySelectorAll('.list-row')].find(node=>node.innerText.includes('核对资料'));
      row?.querySelector('button')?.click();
    })()`);
    await browser.wait("document.querySelector('.sheet')?.innerText.includes('重新打开承诺')");
    await browser.click('.sheet button', '生成预览');
    await browser.wait("window.__crmTest.calls.some(call=>call.action==='previewWorkItem'&&call.operation==='reopen')");
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length===6");

    await browser.click('.today-grid button', '新建承诺');
    await browser.wait("document.querySelector('.sheet input[type=search]')");
    await browser.evaluate("document.querySelector('.sheet input[type=search]').value='客户甲'");
    await browser.click('.sheet button', '查找人物');
    await browser.wait("[...document.querySelectorAll('.sheet button')].some(button=>button.textContent.includes('#980001'))");
    await browser.click('.sheet button', '#980001');
    await browser.evaluate(`(() => {
      document.querySelector('.sheet textarea').value='[CRM_TEST_ONLY]Today新建共同承诺';
      document.querySelector('.sheet select').value='MUTUAL';
      document.querySelector('.sheet input[type=datetime-local]').value='2026-10-19T10:00';
    })()`);
    await browser.click('.sheet button', '生成预览');
    await browser.wait("document.querySelector('.sheet-preview')?.innerText.includes('Today新建共同承诺')");
    const commitmentPreview = await browser.evaluate("window.__crmTest.calls.filter(call=>call.action==='previewWorkItem').at(-1)?.payload");
    assert.equal(commitmentPreview.kind, 'commitment');
    assert.equal(commitmentPreview.operation, 'create');
    assert.equal(commitmentPreview.draft.commitmentType, 'MUTUAL');
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length"), 6);
    await browser.click('.sheet button', '确认并执行');
    await browser.wait("window.__crmTest.calls.filter(call=>call.action==='executeWorkItem'&&!call.rejected).length===7");

    await browser.evaluate("localStorage.setItem('crm_lang','en'); location.reload()");
    await browser.wait("window.__crmTest && document.getElementById('app')?.innerText.includes('Today')");
    await browser.evaluate("location.hash='#/person/980001'");
    await browser.wait("document.querySelectorAll('.tab').length>=8");
    await browser.click('.tab', 'Opps');
    await browser.wait("[...document.querySelectorAll('.tab-stack button')].some(button=>button.textContent.includes('Create Action'))");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.tab-stack button')].some(button=>button.textContent.includes('Create Commitment'))"), true);
    await browser.healthy();
  } finally { await browser.close(); }
});
