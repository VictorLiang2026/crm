'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Browser } = require('../regression/browser.cjs');

test('iPhone 15 Pro Max prioritizes actions, restores capture focus, and keeps table comparison available', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 430, height: 932, deviceScaleFactor: 3, mobile: true,
    });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await browser.openConsole('#/today');
    await browser.wait("document.querySelector('.today-priority-row')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.today-mobile-stack > :first-child .today-priority-row'))"), true);
    assert.equal(await browser.evaluate("document.querySelector('.today-action-menu summary').getBoundingClientRect().height >= 44"), true);

    await browser.evaluate("document.querySelector('.fab').click()");
    await browser.wait("document.activeElement.matches('.sheet[aria-modal=true]')");
    assert.equal(await browser.evaluate("document.querySelector('#app').inert"), true);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await browser.evaluate("Boolean(document.activeElement.closest('.sheet'))"), true);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.wait("document.activeElement.matches('.fab') && !document.querySelector('#app').inert");
    assert.equal(await browser.evaluate("window.__crmTest.calls.some(({ action }) => action === 'executeQuickCapture')"), false);

    await browser.openConsole('#/activity-speakers');
    await browser.wait("document.querySelector('.resource-directory-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelector('.resource-directory-table').parentElement.scrollWidth <= document.querySelector('.resource-directory-table').parentElement.clientWidth + 1"), true);
    await browser.evaluate("document.querySelector('.mobile-compare-toggle').click()");
    assert.equal(await browser.evaluate("document.querySelector('.mobile-compare-toggle').getAttribute('aria-pressed')"), 'true');
    assert.equal(await browser.evaluate("document.querySelector('.resource-directory-table').parentElement.scrollWidth > document.querySelector('.resource-directory-table').parentElement.clientWidth"), true);
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth"), 430);
    await browser.healthy();
  } finally {
    await browser.close();
  }
});
