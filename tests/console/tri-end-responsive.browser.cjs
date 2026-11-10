'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

const VIEWPORTS = [
  { name: 'iPhone portrait', width: 390, height: 844, mobile: true, touch: true, phone: true },
  { name: 'iPhone landscape', width: 844, height: 390, mobile: true, touch: true, phone: true },
  { name: 'iPad compact portrait', width: 768, height: 1024, mobile: false, touch: true, phone: true },
  { name: 'iPad portrait', width: 1024, height: 1366, mobile: false, touch: true, phone: false },
  { name: 'iPad landscape', width: 1366, height: 1024, mobile: false, touch: true, phone: false },
  { name: 'desktop', width: 1440, height: 900, mobile: false, touch: false, phone: false },
];

test('Console exposes the same workspaces and active location across desktop, iPad and iPhone layouts', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    for (const viewport of VIEWPORTS) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
      });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch });
      await browser.openConsole('#/more', 'authCase=1');
      await browser.wait("document.querySelector('.console-main .more-primary')");

      const layout = await browser.evaluate(`(() => {
        const tabbar=document.querySelector('.console-tabbar');
        const nav=document.querySelector('.console-nav');
        const workspaces=document.querySelector('.more-workspaces');
        const hrefs=[...document.querySelectorAll('.console-main .more-section a')].map(x=>x.getAttribute('href'));
        return {tabbar:getComputedStyle(tabbar).display,nav:getComputedStyle(nav).display,
          workspacesOpen:workspaces.open,hrefs,scrollWidth:document.documentElement.scrollWidth,
          innerWidth,tabHeight:document.querySelector('.console-tabbar .tab-item')?.getBoundingClientRect().height,
          navHeight:document.querySelector('.console-nav .nav-item')?.getBoundingClientRect().height};
      })()`);
      assert.equal(layout.scrollWidth <= viewport.width + 1, true, `${viewport.name} More page must not overflow horizontally`);
      assert.ok(layout.hrefs.includes('#/knowledge-library'), `${viewport.name} must expose Knowledge`);
      for (const route of ['#/activities', '#/recruit', '#/ai', '#/people', '#/opportunities']) {
        assert.ok(layout.hrefs.includes(route), `${viewport.name} must expose ${route}`);
      }

      if (viewport.phone) {
        assert.equal(layout.nav, 'none', `${viewport.name} uses compact navigation`);
        assert.equal(layout.tabbar, 'grid', `${viewport.name} shows the bottom tab bar`);
        assert.equal(layout.workspacesOpen, true, `${viewport.name} opens workspace shortcuts by default`);
        assert.ok(layout.tabHeight >= 44, `${viewport.name} tab targets are at least 44px`);
        const active = await browser.evaluate(`(async()=>{
          const {mountShell}=await import('/crm/js/modules/console/shell.js');
          const root=document.createElement('div');document.body.append(root);
          const shell=mountShell({appRoot:root,operator:{name:'T'},onQuickCapture(){}});
          shell.setActive('#/recruit');
          const item=root.querySelector('.console-tabbar [data-nav="#/more"]');
          const result={active:item.classList.contains('active'),current:item.getAttribute('aria-current')};
          root.remove();return result;
        })()`);
        assert.deepEqual(active, { active: true, current: 'page' }, `${viewport.name} keeps More active for overflow modules`);
      } else {
        assert.equal(layout.nav, 'flex', `${viewport.name} shows the primary navigation`);
        assert.equal(layout.tabbar, 'none', `${viewport.name} hides the phone tab bar`);
        assert.ok(layout.navHeight >= 44, `${viewport.name} nav targets are at least 44px`);
        const active = await browser.evaluate(`(async()=>{
          const {mountShell}=await import('/crm/js/modules/console/shell.js');
          const root=document.createElement('div');document.body.append(root);
          const shell=mountShell({appRoot:root,operator:{name:'T'},onQuickCapture(){}});
          shell.setActive('#/knowledge-library');
          const item=root.querySelector('.console-nav [data-nav="#/knowledge-library"]');
          const result={active:item.classList.contains('active'),current:item.getAttribute('aria-current')};
          root.remove();return result;
        })()`);
        assert.deepEqual(active, { active: true, current: 'page' }, `${viewport.name} highlights the selected primary module`);
      }
      await browser.healthy();
      assert.deepEqual(browser.networkViolations, [], `${viewport.name} should not request blocked resources`);
    }
  } finally {
    await browser.close();
  }
});
