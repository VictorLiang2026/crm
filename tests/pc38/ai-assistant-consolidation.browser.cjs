'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC38 consolidates AI routes, workflows and results layout in Console', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    const legacy = [
      ['#/ai', '#/ai'],
      ['#/ai/search', '#/ai'],
      ['#/assistant/actions/new', '#/assistant/actions/new'],
      ['#/assistant/actions/change', '#/assistant/actions/change'],
      ['#/assistant/opportunities/change', '#/assistant/opportunities/change'],
    ];
    for (const [oldHash, destination] of legacy) {
      const target = `${browser.origin}/admin.html?run=${Date.now()}${oldHash}`;
      await browser.send('Page.navigate', { url: target });
      await browser.wait(`location.pathname.endsWith('/console.html') && location.hash === ${JSON.stringify(destination)}`, 45000);
      await browser.wait("document.querySelector('#console-main')");
      assert.ok(await browser.evaluate("document.querySelector('#console-main')"), `${oldHash} must render Console`);
      assert.equal(await browser.evaluate("document.querySelector('#view')"), null);
    }

    await browser.openConsole('#/ai', 'authCase=1');
    await browser.wait("document.querySelectorAll('#console-main .ai-assistant-links a').length === 6");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.ai-assistant-links a')].map(a=>a.getAttribute('href'))"), [
      '#/assistant/actions/new', '#/assistant/actions/change', '#/assistant/opportunities/change',
      '#/people', '#/activities', '#/today',
    ]);
    assert.equal(await browser.evaluate("document.querySelector('#console-main').innerText.includes('机会分析')"), false);

    await browser.evaluate("(async()=>{const i=await import('/crm/js/modules/console/i18n.js');i.setLang('en');location.hash='#/assistant/actions/new'})()");
    await browser.wait("location.hash === '#/assistant/actions/new' && document.querySelector('.crm-action-create')?.innerText.includes('Create Action')");
    assert.equal(await browser.evaluate("document.querySelector('.crm-action-create').innerText.includes('Find Person')"), true);
    await browser.evaluate("(async()=>{const i=await import('/crm/js/modules/console/i18n.js');i.setLang('zh-CN');location.hash='#/assistant/actions/change'})()");
    await browser.wait("location.hash === '#/assistant/actions/change' && document.querySelector('.crm-action-change')");
    assert.equal(await browser.evaluate("document.querySelector('.crm-action-change').innerText.length > 0"), true);
    await browser.evaluate("location.hash='#/assistant/opportunities/change'");
    await browser.wait("document.querySelector('.crm-opp-change')");

    await browser.evaluate("location.hash='#/ai/experience'");
    await browser.wait("document.querySelector('.crm-ai-exp-page .crm-ai-history-filters')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.crm-ai-exp-lower .crm-ai-exp-section').length"), 2);
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      const dimensions = await browser.evaluate(`(()=>({width:innerWidth,doc:document.documentElement.scrollWidth,main:document.querySelector('#console-main').scrollWidth,client:document.querySelector('#console-main').clientWidth}))()`);
      assert.ok(dimensions.doc <= width + 1 && dimensions.main <= dimensions.client + 1,
        `AI results overflow at iPad ${width}x${height}: ${JSON.stringify(dimensions)}`);
    }
    await browser.healthy();
  } finally {
    await browser.close();
  }
});
