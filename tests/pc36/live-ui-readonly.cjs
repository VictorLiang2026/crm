'use strict';
// Local, read-only acceptance probe. The user signs in inside an isolated Edge profile.
// Store route IDs and status only: never save credentials, page text, or network bodies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer-core');

const base = 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/';
const consoleRoutes = ['#/today', '#/people', '#/opportunities', '#/activities', '#/recruit', '#/ai', '#/more', '#/person/783', '#/recycle/recruit'];
const legacyRoutes = [
  '#/account', '#/test-scenario', '#/customers', '#/more/followups', '#/funnels',
  '#/ai-suggestions', '#/more/policy-review', '#/more/products', '#/more/gifts',
  '#/more/photos', '#/speakers', '#/topics', '#/recruit/goals',
  '#/activity/customer', '#/activity/recruit', '#/customers/trash', '#/recruit/trash',
];
const report = { environment: 'crm-d1gkae8ddc930d151', startedAt: new Date().toISOString(), console: [], legacy: [] };
let browser;

async function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(2000);
  }
  throw new Error(label + ' timed out');
}

async function run() {
  browser = await puppeteer.launch({
    executablePath: process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: false,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-ui-')),
    defaultViewport: { width: 1024, height: 768, deviceScaleFactor: 2 },
    args: ['--no-first-run', '--no-default-browser-check'],
    protocolTimeout: 5 * 60 * 1000,
  });
  const page = await browser.newPage();
  let pageErrors = 0;
  let serverErrors = 0;
  page.on('pageerror', () => { pageErrors += 1; });
  page.on('response', response => {
    if (response.status() >= 500 && response.url().includes('tcloudbase')) serverErrors += 1;
  });
  await page.goto(base + 'console.html#/today', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('PC36 UI login: ' + base + 'console.html#/today');
  console.log('请在新窗口登录测试账号；登录后只读页面核查会自动开始。');
  await waitUntil(async () => !!(await page.$('#console-main')), 8 * 60 * 60 * 1000, 'Console login');
  await pause(1000);

  for (const route of consoleRoutes) {
    const beforePage = pageErrors;
    const beforeServer = serverErrors;
    await page.evaluate(hash => { location.hash = hash; }, route);
    await pause(2000);
    const state = await page.evaluate(() => {
      const main = document.querySelector('#console-main');
      return { shell: !!document.querySelector('.console-topbar'), children: main?.childElementCount || 0,
        locked: !!document.querySelector('.modal-overlay form input[name="password"]') };
    });
    report.console.push({ route, status: state.shell && state.children > 0 && !state.locked &&
      pageErrors === beforePage && serverErrors === beforeServer ? 'PASS' : 'FAIL',
      pageErrors: pageErrors - beforePage, serverErrors: serverErrors - beforeServer });
  }

  await page.goto(base + 'admin.html#/customers', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // admin.html keeps loginReady inside an IIFE. Its module switch is shown by setLoginReady(true).
  await waitUntil(() => page.evaluate(() => {
    const nav = document.getElementById('mod-switch');
    return !!nav && nav.style.display !== 'none' && !document.querySelector('.relogin-overlay');
  }), 15 * 60 * 1000, 'Legacy login');
  for (const route of legacyRoutes) {
    const beforePage = pageErrors;
    const beforeServer = serverErrors;
    await page.evaluate(hash => { location.hash = hash; }, route);
    await pause(2000);
    const state = await page.evaluate(() => {
      const view = document.querySelector('#view');
      const first = (view?.innerText || '').trim().slice(0, 180);
      const nav = document.getElementById('mod-switch');
      return { ready: !!nav && nav.style.display !== 'none' && !document.querySelector('.relogin-overlay'),
        children: view?.childElementCount || 0,
        failed: /^(操作未完成|加载失败|发生错误|Error:|permission denied)/i.test(first) };
    });
    report.legacy.push({ route, status: state.ready && state.children > 0 && !state.failed &&
      pageErrors === beforePage && serverErrors === beforeServer ? 'PASS' : 'FAIL',
      pageErrors: pageErrors - beforePage, serverErrors: serverErrors - beforeServer,
      ...(state.ready && state.children > 0 && !state.failed ? {} : { ready: state.ready, children: state.children, failed: state.failed }) });
  }
  try {
    await page.evaluate(async () => { await cloudbase.init({ env: 'crm-d1gkae8ddc930d151' }).auth({ persistence: 'local' }).signOut(); });
    report.signOut = 'PASS';
  } catch { report.signOut = 'UNVERIFIED'; }
  if ([...report.console, ...report.legacy].some(row => row.status !== 'PASS')) {
    report.probe = 'FAIL';
    process.exitCode = 1;
  }
}

run().catch(error => {
  report.probe = 'FAIL';
  process.exitCode = 1;
  report.failureStage = report.console.length < consoleRoutes.length ? 'console-login-or-routes' : 'legacy-login-or-routes';
  console.error('PC36 UI probe stopped:', error.message);
}).finally(async () => {
  report.finishedAt = new Date().toISOString();
  const output = path.join(__dirname, '..', 'security', '.results', 'pc36-live-ui.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, console: report.console.length, legacy: report.legacy.length,
    failed: [...report.console, ...report.legacy].filter(row => row.status !== 'PASS').length,
    probe: report.probe || 'COMPLETE' }));
  if (browser) await browser.close();
});
