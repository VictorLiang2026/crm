const puppeteer = require('puppeteer-core');
const path = require('path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8765';
const OUT = path.join(__dirname, '..', 'shots');

const ipad = [
  ['ipad-1-today', '/iPad.html?demo=1#/today', true],
  ['ipad-2-person', '/iPad.html?demo=1#/person/1', true],
  ['ipad-3-opps', '/iPad.html?demo=1#/opportunities', true],
  ['ipad-4-activity', '/iPad.html?demo=1#/activity/501/' + encodeURIComponent('活动概览'), true],
  ['ipad-5-recruit', '/iPad.html?demo=1#/recruit', true],
  ['ipad-6-ai', '/iPad.html?demo=1#/ai', true],
  ['ipad-7-insurance', '/iPad.html?demo=1#/person/1/' + encodeURIComponent('保险概览'), true],
  ['ipad-8-people', '/iPad.html?demo=1#/people', true],
  ['ipad-9-command', '/iPad.html?demo=1#/command', true],
];
const phone = [
  ['phone-1-today', '/iPhone.html?demo=1#/today'],
  ['phone-2-people', '/iPhone.html?demo=1#/people'],
  ['phone-3-person', '/iPhone.html?demo=1#/person/1'],
  ['phone-4-opps', '/iPhone.html?demo=1#/opportunities'],
  ['phone-5-activities', '/iPhone.html?demo=1#/activities'],
  ['phone-6-recruit', '/iPhone.html?demo=1#/recruit'],
  ['phone-7-ai', '/iPhone.html?demo=1#/ai'],
  ['phone-8-login', '/iPhone.html#/today'],
  ['phone-9-capture', '/iPhone.html?demo=1#/capture'],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    defaultArgs: ['--disable-extensions', '--no-first-run', '--no-default-browser-check'],
  });
  // iPad
  let page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  for (const [name, url, full] of ipad) {
    await page.goto(BASE + url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
    console.log('ok', name);
  }
  await page.close();
  // iPhone frame (viewport 470x1000)
  page = await browser.newPage();
  await page.setViewport({ width: 470, height: 1000, deviceScaleFactor: 1 });
  for (const [name, url] of phone) {
    await page.goto(BASE + url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('ok', name);
  }
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
