'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Opportunity create renders and selects Person search candidates', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/opportunities', 'authCase=1');
    await browser.evaluate(`(async () => {
      const { openOpportunityCreate } = await import('/crm/js/modules/console/write.js');
      const { t } = await import('/crm/js/modules/console/i18n.js');
      window.opportunityCandidates = [];
      const ctx = { api: { call: async (name, payload) => {
        if (name !== 'person_360' || payload.action !== 'search') throw new Error('Unexpected API call');
        return { candidates: window.opportunityCandidates };
      } }, toast: () => {} };
      window.openOpportunitySearchFixture = candidates => {
        window.opportunityCandidates = candidates;
        openOpportunityCreate(ctx, { onDone: () => {} });
      };
      window.opportunitySearchLabel = t('search_person');
      window.opportunityNoResultLabel = t('no_person_found');
      window.openOpportunitySearchFixture([{ id: 'CRM_TEST_ONLY_1', display_name: '[CRM_TEST_ONLY]林甲' }]);
    })()`);

    const search = async name => {
      await browser.evaluate(`(() => {
        const input = document.querySelector('.sheet input.sheet-input');
        input.value = ${JSON.stringify(name)};
        [...document.querySelectorAll('.sheet button')]
          .find(button => button.textContent.trim() === window.opportunitySearchLabel).click();
      })()`);
    };
    await search('林甲');
    await browser.wait("document.querySelector('.sheet .cand')?.textContent.includes('[CRM_TEST_ONLY]林甲')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.sheet .cand').length"), 1);
    assert.equal(await browser.evaluate("document.querySelector('.sheet .cand').classList.contains('active')"), true);
    assert.equal(await browser.evaluate("document.querySelector('.sheet').innerText.includes('[object HTMLDivElement]')"), false);

    await browser.evaluate(`(() => {
      document.querySelector('.sheet-overlay').remove();
      window.openOpportunitySearchFixture([
        { id: 'CRM_TEST_ONLY_2', display_name: '[CRM_TEST_ONLY]林乙' },
        { id: 'CRM_TEST_ONLY_3', display_name: '[CRM_TEST_ONLY]林丙' },
      ]);
    })()`);
    await search('林');
    await browser.wait("document.querySelectorAll('.sheet .cand').length === 2");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.sheet .cand')].some(node => node.classList.contains('active'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('.sheet').innerText.includes('[object HTMLDivElement]')"), false);
    await browser.evaluate("document.querySelectorAll('.sheet .cand')[1].click()");
    assert.equal(await browser.evaluate("document.querySelectorAll('.sheet .cand.active').length"), 1);
    assert.equal(await browser.evaluate("document.querySelectorAll('.sheet .cand')[1].classList.contains('active')"), true);

    await browser.evaluate(`(() => {
      document.querySelector('.sheet-overlay').remove();
      window.openOpportunitySearchFixture([]);
    })()`);
    await search('不存在');
    await browser.wait("document.querySelector('.sheet .sheet-err')?.textContent === window.opportunityNoResultLabel");
    assert.equal(await browser.evaluate("document.querySelectorAll('.sheet .cand').length"), 0);
    await browser.healthy();
  } finally { await browser.close(); }
});
