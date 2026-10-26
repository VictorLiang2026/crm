'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

const LEGACY_ROUTES = [
  ['#/account', '账号与应用维护'],
  ['#/test-scenario', '生成 / 打开测试场景'],
  ['#/customers', '[CRM_TEST_ONLY]客户甲'],
  ['#/more/followups', '传统跟进'],
  ['#/funnels', '漏斗'],
  ['#/ai-suggestions', 'AI 建议'],
  ['#/more/policy-review', '保单检视'],
  ['#/more/products', '产品'],
  ['#/more/gifts', '伴手礼'],
  ['#/more/photos', '照片'],
  ['#/speakers', '嘉宾'],
  ['#/topics', '主题'],
  ['#/recruit/goals', '目标'],
  ['#/activity/customer', '客户'],
  ['#/activity/recruit', '增员'],
  ['#/customers/trash', '[CRM_TEST_ONLY]已删除客户'],
  ['#/recruit/trash', '[CRM_TEST_ONLY]已删除候选人'],
];

const REMAINING_MORE_ROUTES = [];

test('Console More keeps only uncovered gaps bilingual and preserves all 17 old URLs', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.evaluate("localStorage.setItem('crm_lang', 'en')");
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('#console-main .more-section')");
    await browser.evaluate("document.querySelector('.more-workspaces').open=true");

    const english = await browser.evaluate(`({
      headings: [...document.querySelectorAll('#console-main .more-section > .section-title')].map(x => x.innerText.trim()),
      legacyHrefs: [...document.querySelectorAll('#console-main a[href^="/crm/admin.html#"]')].map(x => x.getAttribute('href')).sort(),
      legacyStatusCount: [...document.querySelectorAll('#console-main a[href^="/crm/admin.html#"]')].filter(x => x.innerText.includes('Legacy')).length,
      subtitle: document.querySelector('#console-main .page-sub')?.innerText,
      currentRecycle: document.querySelector('#console-main a[href="#/recycle"]')?.innerText,
      quickRecord: document.querySelector('#console-main .tile-grid button')?.innerText,
      signOut: document.querySelector('#console-main .more-actions button')?.innerText,
      nav: [...document.querySelectorAll('.console-nav .nav-item')].map(x => x.getAttribute('href')),
    })`);
    assert.deepEqual(english.headings, ['Tools', 'Workspaces & Quick Record']);
    assert.deepEqual(english.legacyHrefs, REMAINING_MORE_ROUTES.map(hash => '/crm/admin.html' + hash).sort());
    assert.equal(english.legacyStatusCount, REMAINING_MORE_ROUTES.length);
    assert.equal(english.subtitle, 'Workspaces and system tools.');
    assert.match(english.currentRecycle || '', /Recycle Bin/);
    assert.match(english.quickRecord || '', /confirm the Person/);
    assert.match(english.signOut || '', /Sign Out/);
    assert.deepEqual(english.nav, ['#/today', '#/people', '#/opportunities', '#/activities', '#/recruit', '#/ai', '#/more']);

    await browser.evaluate("localStorage.setItem('crm_lang', 'zh-CN')");
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('#console-main .more-primary')");
    assert.equal(await browser.evaluate("document.querySelector('.more-compat')"),null);
    await browser.evaluate("document.querySelector('.more-workspaces').open=true");
    const chinese = await browser.evaluate("document.querySelector('#console-main').innerText");
    for (const label of ['工作区域与系统工具。', '常用工具', '知识与话术', '经营分析', '回收站', '工作区捷径与快速记录']) {
      assert.ok(chinese.includes(label), `Missing Chinese label: ${label}`);
    }
    assert.equal(/WP[0-9]/.test(chinese), false);

    for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile: false });
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main .more-section a')].every(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.right<=innerWidth+1})"), true);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');

    await browser.evaluate("document.querySelector('.console-nav a[href=\"#/people\"]').click()");
    await browser.wait("location.hash === '#/people' && document.querySelector('#console-main .people-table')");
    await browser.evaluate('history.back()');
    await browser.wait("location.hash === '#/more' && document.querySelector('#console-main .more-section')");
    await browser.evaluate('history.forward()');
    await browser.wait("location.hash === '#/people' && document.querySelector('#console-main .people-table')");

    for (const [hash, marker] of LEGACY_ROUTES) {
      await browser.openConsole('#/more', 'authCase=1');
      await browser.wait("document.querySelector('#console-main .more-section')");
      const target = '/crm/admin.html' + hash;
      if (REMAINING_MORE_ROUTES.includes(hash)) {
        await browser.evaluate(`(() => {
          document.querySelector('.more-compat').open=true;
          [...document.querySelectorAll('#console-main a')].find(a => a.getAttribute('href') === ${JSON.stringify(target)}).click();
        })()`);
      } else {
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('#console-main a')].some(a=>a.getAttribute('href')===${JSON.stringify(target)})`), false,
          `Duplicate More card remains: ${hash}`);
        // These bookmarks must still work even though the duplicate card was removed.
        await browser.send('Page.navigate', { url: browser.origin + '/crm/admin.html?authCase=1&run=' + Date.now() + hash });
      }
      await browser.wait(`location.pathname === '/crm/admin.html' && location.hash === ${JSON.stringify(hash)}`);
      await browser.wait(`document.getElementById('view')?.innerText?.includes(${JSON.stringify(marker)})`, 15000);
      const pageText = await browser.evaluate("document.getElementById('view').innerText");
      assert.ok(!pageText.includes('CRM 登录'), `${hash} returned to login`);
      assert.ok(pageText.includes(marker), `${hash} did not render its expected target (${marker}): ${pageText.slice(0, 500)}`);
      assert.equal(await browser.evaluate("window.__crmTest.calls.some(c=>['create','update','delete','restore','execute'].includes(c.action))"), false,
        `${hash} attempted a business write while opening`);
    }

    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('#console-main .more-section')");
    await browser.evaluate("document.querySelector('#console-main a[href=\"#/recycle\"]').click()");
    await browser.wait("document.querySelector('.recycle-hub')");
    await browser.evaluate("document.querySelector('.recycle-hub a[href=\"#/people-trash\"]').click()");
    await browser.wait("location.hash === '#/people-trash' && document.querySelector('#console-main')?.innerText.includes('回收站')");
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('#console-main .more-section')");
    await browser.evaluate("document.querySelector('#console-main a[href=\"#/settings\"]').click()");
    await browser.wait("location.hash === '#/settings' && document.querySelector('#console-main')?.innerText.includes('当前密码')");
    await browser.healthy();
  } finally {
    await browser.close();
  }
});
