'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person gifts entry reuses records, supports Person-only profiles and retains care links', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/people');
    await b.evaluate(`(async () => {
      const { data } = await import('/crm/js/modules/console/data.js');
      window.giftReads = [];
      window.giftData = data;
      data.customerProfile = async () => ({ status: 'linked', personId: '980001', customerId: 71, fields: {} });
      data.gifts = async (ctx, id) => {
        window.giftReads.push({ kind: 'gifts', id });
        return { rows: [{ Id: 1001, person_id: 980001, gift_name: '[CRM_TEST_ONLY]原有伴手礼', quantity: 2 }], hasMore: false };
      };
      data.photos = async (ctx, id) => { window.giftReads.push({ kind: 'photos', id }); return { rows: [] }; };
      location.hash = '#/person/980001/gifts';
    })()`);
    await b.wait("document.querySelector('.care-record-title')?.textContent.includes('原有伴手礼')");
    assert.equal(await b.evaluate("document.querySelector('[data-person-section=gifts]')?.getAttribute('aria-pressed')"), 'true');
    assert.equal(await b.evaluate("document.querySelector('[data-person-section=gifts]')?.textContent"), '伴手礼');
    assert.equal(await b.evaluate("window.giftReads.some(x => x.kind === 'photos')"), false);
    assert.equal(await b.evaluate("document.querySelectorAll('.care-materials-section').length"), 1);
    assert.ok((await b.evaluate('window.giftReads')).every(x => String(x.id) === '980001'));
    for (const [width, height] of [[1440, 900], [820, 1180], [1180, 820], [390, 844]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await b.evaluate("document.querySelector('[data-person-section=overview]').click()");
      await b.wait("document.querySelector('[data-person-section=overview][aria-pressed=true]')");
      await b.evaluate("document.querySelector('[data-person-section=gifts]').click()");
      await b.wait("document.querySelector('.care-record-title')?.textContent.includes('原有伴手礼')");
      assert.equal(await b.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    }
    await b.evaluate("location.hash = '#/person/980001/care'");
    await b.wait("document.querySelector('.care-workspace-links') && window.giftReads.some(x => x.kind === 'photos')");
    assert.equal(await b.evaluate("document.querySelector('.care-record-title')?.textContent"), '[CRM_TEST_ONLY]原有伴手礼');
    await b.evaluate(`(async () => {
      window.giftData.customerProfile = async () => ({ status: 'person_only', personId: '980001', customerId: null, fields: {} });
      const { setLang } = await import('/crm/js/modules/console/i18n.js');
      setLang('en');
      window.giftReads.length = 0;
      location.hash = '#/person/980001/gifts';
    })()`);
    await b.wait("document.querySelector('[data-person-section=gifts]')?.textContent === 'Gifts' && document.querySelector('.care-record-title')");
    assert.equal(await b.evaluate("window.giftReads.some(x => x.kind === 'photos')"), false);
    assert.equal(await b.evaluate("document.querySelector('.care-section-head button')?.textContent"), 'Add Gift');
    await b.healthy();
  } finally { await b.close(); }
});

test('Activity tabs retain photos, review and resources after removing gifts', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/activities');
    await b.evaluate(`(async () => {
      const { data } = await import('/crm/js/modules/console/data.js');
      data.activityReviewHistory = async () => ({ versions: [], outcomes: [] });
      location.hash = '#/activity/42';
    })()`);
    await b.wait("document.querySelector('.tabs-body') && document.querySelectorAll('button.tab').length === 7");
    for (const [width, height] of [[390, 844], [820, 1180], [1440, 900]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      const labels = await b.evaluate("[...document.querySelectorAll('button.tab')].map(x => x.textContent)");
      assert.equal(labels.includes('伴手礼'), false);
      assert.deepEqual(labels.slice(4), ['照片', '复盘', '嘉宾与主题']);
      await b.click('button.tab', '照片');
      await b.wait("[...document.querySelectorAll('.tabs-body > div')].find(x => x.style.display !== 'none')?.textContent.includes('照片')");
      assert.equal(await b.evaluate("[...document.querySelectorAll('.tabs-body > div')].find(x => x.style.display !== 'none')?.querySelector('.pc18-review') != null"), false);
      await b.click('button.tab', '复盘');
      await b.wait("[...document.querySelectorAll('.tabs-body > div')].find(x => x.style.display !== 'none')?.querySelector('.pc18-review')");
      await b.click('button.tab', '嘉宾与主题');
      await b.wait("[...document.querySelectorAll('.tabs-body > div')].find(x => x.style.display !== 'none')?.querySelector('.act-resources')");
    }
    await b.healthy();
  } finally { await b.close(); }
});
