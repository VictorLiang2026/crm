'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Console test tools keep authorization and human confirmation before writes in both languages', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/settings', 'authCase=1&v2=1');
    await browser.wait("document.querySelector('#console-main a[href=\"#/test-scenario\"]')");
    assert.equal(await browser.evaluate("document.querySelector('#console-main a[href=\"#/test-scenario\"]').getAttribute('href')"), '#/test-scenario');
    await browser.evaluate("document.querySelector('#console-main a[href=\"#/test-scenario\"]').click()");
    await browser.wait("location.hash === '#/test-scenario' && document.querySelector('#console-main .page-title')");
    assert.equal(await browser.evaluate("document.querySelector('#console-main .page-title').textContent"), '生成 / 打开测试场景');
    await browser.evaluate("localStorage.setItem('crm_lang','en')");
    await browser.openConsole('#/test-scenario', 'authCase=1&v2=1');
    await browser.wait("document.querySelector('#console-main .page-title')?.textContent === 'Create / Open Test Scenario'");
    await browser.evaluate("import('/crm/js/modules/console/i18n.js').then(m => m.setLang('zh-CN'))");

    await browser.evaluate(`(async () => {
      location.hash = '#/test-scenario';
      const { renderTestScenario, renderTestAction } = await import('/crm/js/modules/console/test-tools.js');
      const root = document.getElementById('console-main');
      const calls = [];
      let ready = false;
      const scenarioApi = { call: async (name, payload) => {
        calls.push({ name, ...payload });
        if (payload.stage === 'execute') ready = true;
        return { ok:true, ready, initialCount:ready ? 10 : 0, derivedCount:0, auditCount:0,
          targets:{ personId:91, customerId:92, activityId:93 },
          previewId:'00000000-0000-4000-8000-000000000003',previewHash:'a'.repeat(32),
          identity:{ name:'【系统测试·勿联系】虚构体验甲', decision:'confirm_new' },
          preview:{ rows:[{table:'persons',count:1}],triggerBusinessRows:0,initialNew:10,initialTotal:10,maximum:10 } };
      } };
      window.toolTest = { calls, renderTestScenario, renderTestAction, root, scenarioApi };
      renderTestScenario({ main:root, api:scenarioApi });
    })()`);
    await browser.wait("document.querySelector('#console-main button').disabled === false");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('生成测试场景')).disabled"), true);
    await browser.click('#console-main button', '预览生成计划');
    await browser.wait("document.querySelector('#console-main').innerText.includes('生成前预览')");
    assert.equal(await browser.evaluate("window.toolTest.calls.some(x=>x.stage==='execute')"), false);
    await browser.click('#console-main button', '确认身份与预览');
    await browser.wait("document.querySelector('#console-main').innerText.includes('已确认')");
    await browser.click('#console-main button', '生成测试场景');
    await browser.wait("document.querySelector('#console-main').innerText.includes('初始样本 10 / 10')");
    assert.deepEqual(await browser.evaluate("window.toolTest.calls.map(x=>x.stage)"), ['status','dryRun','confirm','execute']);
    assert.equal(await browser.evaluate("document.querySelector('#console-main a[href=\"#/test-scenario/action\"]').textContent"), '预填下一步行动');
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main a[href^=\"/crm/admin.html\"]')].length"), 0);
    await browser.send('Emulation.setDeviceMetricsOverride', { width:820, height:1180, deviceScaleFactor:2, mobile:false });
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate(`window.toolTest.renderTestScenario({main:window.toolTest.root,api:{call:async()=>({ok:false,error:{code:'SEED_FORBIDDEN'}})}})`);
    await browser.wait("document.querySelector('#console-main').innerText.includes('仅供已授权测试账号')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main button')].every(x=>x.disabled)"), true);

    await browser.evaluate(`(async () => {
      history.replaceState(null, '', '#/test-scenario/action');
      const api = { call: async (name, payload) => {
        window.toolTest.calls.push({name,...payload});
        if (name === 'assistant' && payload.action === 'testSamples') return {ok:true,ready:true};
        if (name === 'person_360') return {candidates:[{id:91,display_name:'【系统测试·勿联系】虚构体验甲'}],hasMore:false};
        if (payload.stage === 'plan') return {ok:true,commandId:'11111111-1111-4111-8111-111111111111'};
        if (payload.stage === 'preview') return {ok:true,previewHash:'b'.repeat(32),preview:{person:{id:91,displayName:'虚构体验甲'},after:{title:'下一步体验行动',action_type:'other',priority:'medium',due_at:null,description:''}}};
        if (payload.stage === 'confirm') return {ok:true};
        if (payload.stage === 'execute') return {ok:true,actionId:99};
        throw Error('Unexpected call');
      } };
      window.toolTest.renderTestAction({main:window.toolTest.root,api});
    })()`);
    await browser.wait("document.querySelector('#console-main .page-title')?.textContent === '预填下一步行动'");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('执行创建')).disabled"), true);
    await browser.click('#console-main button','查找人物');
    await browser.wait("document.querySelector('#console-main').innerText.includes('请选择正确的人物')");
    await browser.click('#console-main button','虚构体验甲');
    await browser.evaluate("document.querySelector('#console-main form').requestSubmit()");
    await browser.wait("document.querySelector('#console-main').innerText.includes('已规划')");
    await browser.click('#console-main button','查看预览');
    await browser.wait("document.querySelector('#console-main').innerText.includes('创建前预览')");
    assert.equal(await browser.evaluate("window.toolTest.calls.some(x=>x.stage==='execute' && x.action==='command')"), false);
    await browser.click('#console-main button','确认预览');
    await browser.wait("document.querySelector('#console-main').innerText.includes('已确认预览')");
    await browser.click('#console-main button','执行创建');
    await browser.wait("document.querySelector('#console-main').innerText.includes('行动已创建：#99')");
    assert.deepEqual(await browser.evaluate("window.toolTest.calls.filter(x=>x.action==='command').map(x=>x.stage)"), ['plan','preview','confirm','execute']);
    await browser.healthy();
  } finally { await browser.close(); }
});
