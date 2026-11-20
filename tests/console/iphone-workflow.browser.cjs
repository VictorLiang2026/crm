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
    assert.equal(await browser.evaluate("window.__crmTest.calls.some(({ action }) => ['executeIdentity','previewIdentity','commitQuickCaptureV2','quick_capture'].includes(action))"), false);

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

test('iPhone editor and import steps protect drafts and delay writes until confirmation', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
    await browser.openConsole('#/knowledge-library');
    await browser.wait("document.querySelector('a[href=\"#/knowledge/new\"]')");
    await browser.evaluate("document.querySelector('a[href=\"#/knowledge/new\"]').click()");
    await browser.wait("document.querySelector('.kg-mobile-step')");
    await browser.evaluate(`(() => {
      window.discardRequests = 0;
      window.confirm = () => { window.discardRequests++; return false; };
      const form = document.querySelector('.kg-page-form');
      for (const [name, value] of [['title','Fixture knowledge'], ['content','Synthetic draft']]) {
        form.elements[name].value = value;
        form.elements[name].dispatchEvent(new Event('input', { bubbles: true }));
      }
      form.querySelector('.btn-primary[type=button]').click();
      form.querySelector('[name=categories]').click();
      form.querySelector('.btn-primary[type=button]').click();
    })()`);
    assert.equal(await browser.evaluate("document.querySelector('.kg-mobile-step:not([hidden]) h2').textContent"), 'Fixture knowledge');
    await browser.evaluate('history.back()');
    await browser.wait("window.discardRequests === 1 && location.hash === '#/knowledge/new'");
    assert.equal(await browser.evaluate("document.querySelector('.kg-page-form [name=content]').value"), 'Synthetic draft');
    await browser.evaluate("window.confirm = () => true; history.back()");
    await browser.wait("location.hash === '#/knowledge-library' && !document.querySelector('.kg-mobile-step')");

    await browser.openConsole('#/people-list-transfer');
    await browser.wait("document.querySelector('[data-import-step=\"0\"]')");
    await browser.evaluate("document.querySelector('.plt-section-head button').click()");
    await browser.wait("document.querySelector('[data-import-step=\"1\"] .plt-mapping select')");
    await browser.evaluate("document.querySelector('.plt-mapping .plt-actions button').click()");
    await browser.wait("document.querySelector('[data-import-step=\"2\"] .plt-confirm-bar button')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.some(c => c.action === 'executePersonListTransfer')"), false);
    await browser.evaluate("document.querySelector('.plt-confirm-bar button').click()");
    await browser.wait("window.__crmTest.calls.some(c => c.action === 'executePersonListTransfer')");
    await browser.wait("document.querySelector('[data-plt-status]')?.textContent.includes('导入完成')");

    await browser.openConsole('#/today');
    await browser.wait("document.querySelector('.fab')");
    await browser.evaluate(`(() => {
      window.confirm = () => false;
      document.querySelector('.fab').click();
      const textarea = document.querySelector('.sheet textarea');
      textarea.value = 'Synthetic capture';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.sheet-head button').click();
    })()`);
    assert.equal(await browser.evaluate("document.querySelector('.sheet-draft-active textarea').value"), 'Synthetic capture');
    await browser.evaluate("window.confirm = () => true; document.querySelector('.sheet-head button').click()");
    await browser.wait("!document.querySelector('.sheet-overlay')");
    await browser.evaluate(`(async () => {
      const {openUnifiedInteraction} = await import('/crm/js/modules/console/person-interaction.js');
      openUnifiedInteraction({}, {personId: '980001'});
    })()`);
    await browser.wait("document.querySelector('.sheet textarea[name=summary]')");
    await browser.evaluate(`(() => {
      window.confirm = () => false;
      const summary = document.querySelector('.sheet textarea[name=summary]');
      summary.value = 'Manual draft';
      summary.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.sheet-actions .btn-ghost').click();
    })()`);
    assert.equal(await browser.evaluate("document.querySelector('.sheet-draft-active textarea[name=summary]').value"), 'Manual draft');
    await browser.evaluate("window.confirm = () => true; document.querySelector('.sheet-actions .btn-ghost').click()");
    await browser.wait("!document.querySelector('.sheet-overlay')");
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth"), 430);
    await browser.healthy();
  } finally {
    await browser.close();
  }
});

test('iPhone Person deep links open the right group and chart points expose their values', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
    await browser.openConsole('#/person/980001/relationships');
    await browser.wait("document.querySelector('.person-mobile-business[open] .tab.active')?.dataset.personSection === 'relationships'");
    assert.equal(await browser.evaluate("document.querySelector('.person-mobile-back').hash"), '#/people');
    await browser.evaluate("document.querySelector('[data-person-section=timeline]').click()");
    assert.equal(await browser.evaluate("document.querySelector('.person-mobile-navigation .tab.active').dataset.personSection"), 'timeline');
    await browser.openConsole('#/analytics');
    await browser.wait("document.querySelector('[data-analytics-facts] .chart-bar')");
    await browser.evaluate(`(() => {
      const chart = document.querySelector('.chart-bar').closest('.interactive-chart');
      chart.closest('details').open = true;
      chart.querySelector('.chart-bar').click();
    })()`);
    assert.match(await browser.evaluate("document.querySelector('.chart-selection').textContent"), / · 1$/);
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth"), 430);
    await browser.healthy();
  } finally {
    await browser.close();
  }
});
