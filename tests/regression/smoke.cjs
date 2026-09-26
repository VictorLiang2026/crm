'use strict';
const assert = require('node:assert/strict');
const { Browser } = require('./browser.cjs');

module.exports = async function smoke(root, test) {
  const b = new Browser(root);
  const text = value => `document.getElementById('view').innerText.includes(${JSON.stringify(value)})`;
  const called = (name, action) => `window.__crmTest.calls.some(c => c.name === ${JSON.stringify(name)} && c.action === ${JSON.stringify(action)})`;
  const open = async (route, expected, query = '') => { await b.open(route, query); await b.wait(text(expected)); };
  const check = (id, title, fn) => test(id, title, 'browser / isolated fixtures', async () => { await fn(); await b.healthy(); });
  try {
    if (!await test('browser.start', '隔离浏览器启动', 'harness', () => b.start())) return;
    await check('login.empty', '登录入口：空字段不发起认证', async () => {
      await open('#/customers', 'CRM 登录', 'login=required');
      await b.click('button', '登录');
      await b.wait(text('请输入用户名和密码'));
      assert.equal(await b.evaluate('window.__crmTest.loginAttempts'), 0);
      assert.equal(await b.evaluate('window.__crmTest.calls.length'), 0);
    });
    await check('login.denied', '错误凭据保持登录页并显示失败', async () => {
      await b.evaluate("document.querySelector('[name=username]').value='wrong'; document.querySelector('[name=password]').value='wrong'");
      await b.click('button', '登录');
      await b.wait(text('TEST_LOGIN_DENIED'));
      assert.equal(await b.evaluate('window.__crmTest.calls.length'), 0);
    });
    await check('login.success', '模拟登录成功后进入原目标路由', async () => {
      await b.evaluate("document.querySelector('[name=username]').value='[CRM_TEST_ONLY]'; document.querySelector('[name=password]').value='local-fixture-only'");
      await b.click('button', '登录');
      await b.wait(text('[CRM_TEST_ONLY]客户甲'));
      await b.wait(called('customers', 'list'));
    });
    await check('customers.list', '客户列表显示记录与客户详情导航', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户甲');
      await b.click('#view a', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('customers', 'get'));
      await b.wait(text('总览'));
      assert.equal(await b.evaluate('location.hash'), '#/customer/910001');
    });
    await check('customer.detail', '客户详情及跟进下一步展示', async () => {
      await open('#/customer/910001', '[CRM_TEST_ONLY]预约沟通');
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.name==='customers' && c.action==='get').id"), 910001);
    });
    await check('person360.family', 'Person 360 独立入口显示家庭成员与事实且只读加载', async () => {
      await b.click('#view a', 'Person 360');
      await b.wait(text('家庭成员'));
      await b.wait(text('重要家庭事实'));
      assert.equal(await b.evaluate('location.hash'), '#/person/980001');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='get' && c.personId==='980001')"), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && ['addMember','saveFacts'].includes(c.action))"), false);
    });
    await check('person360.search', '家庭成员只能搜索并选择已有 Person', async () => {
      await b.evaluate("document.querySelector('.person360-row input').value='[CRM_TEST_ONLY]家人乙'");
      await b.click('.person360-row button', '查找');
      await b.wait(text('[CRM_TEST_ONLY]家人乙'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='search')"), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='persons' && c.action==='create')"), false);
      await open('#/customer/910001', '[CRM_TEST_ONLY]预约沟通');
    });
    await check('person360.details', 'Person 360 显示已确认成员与重要家庭事实', async () => {
      await open('#/person/980001', '[CRM_TEST_ONLY]家人乙', 'mode=family');
      assert.equal(await b.evaluate("document.querySelector('.person360-facts').value"), '[CRM_TEST_ONLY]周末一起探望父母');
      assert.equal(await b.evaluate("document.querySelector('.person360-member').innerText.includes('配偶')"), true);
      await open('#/customer/910001', '[CRM_TEST_ONLY]预约沟通');
    });
    await check('followups.tab', '跟进标签显示跟进记录', async () => {
      await b.click('.tab', '跟进记录');
      await b.wait(text('[CRM_TEST_ONLY]跟进内容'));
    });
    await check('opportunities.tab', '机会标签加载当前客户的经营机会', async () => {
      await b.click('.tab', '经营机会');
      await b.wait(text('家庭保障'));
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.name==='opportunities').customer_id"), 910001);
    });
    await check('customers.pagination', '客户分页每页最多50条且第二页可达', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户', 'mode=pagination');
      assert.equal(await b.evaluate("document.querySelectorAll('#view tbody tr').length"), 50);
      await b.click('#view button', '下一页');
      await b.wait("document.querySelectorAll('#view tbody tr').length === 5");
    });
    await check('customers.search', '客户搜索无匹配提示', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户甲');
      await b.evaluate("document.querySelector('input[type=search]').value='NO_MATCH_TEST_ONLY'");
      await b.click('#view button', '搜索');
      await b.wait(text('没有找到匹配的客户'));
    });
    await check('today.page', '今日经营页使用隔离建议响应', async () => {
      // A fresh origin-local cache is cleared; no real AI request can leave the harness.
      await b.evaluate('localStorage.clear()');
      await b.open('#/today');
      await b.wait(called('today_coach', 'generate'));
      await b.wait(text('[CRM_TEST_ONLY]今日行动'));
      await b.click('.coach-name', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('customers', 'get'));
      assert.equal(await b.evaluate('location.hash'), '#/customer/910001');
    });
    await check('funnels.page', '漏斗事实卡展示三个漏斗，不调用AI解读', async () => {
      await open('#/funnels', '[CRM_TEST_ONLY]阶段');
      assert.equal(await b.evaluate("document.querySelectorAll('.fn-total').length"), 3);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='explain')"), false);
    });
    await check('activities.list', '活动列表点击进入活动详情', async () => {
      await open('#/activities', '[CRM_TEST_ONLY]活动甲');
      await b.click('#view strong', '[CRM_TEST_ONLY]活动甲');
      await b.wait(called('activities', 'get'));
      await b.wait(text('[CRM_TEST_ONLY]活动说明'));
    });
    await check('activity.detail', '活动详情显示参与人及异步待办区', async () => {
      await open('#/activity/940001', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('activity_tasks', 'list'));
      await b.wait("!document.querySelector('#view .loading')");
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.name==='activities' && c.action==='get').id"), 940001);
    });
    await check('recruit.list', '增员列表与漏斗加载', async () => {
      await open('#/recruit', '[CRM_TEST_ONLY]候选人甲');
      await b.wait(called('recruit_candidates', 'funnel'));
    });
    await check('recruit.detail', '增员详情与增员跟进标签', async () => {
      await open('#/recruit/930001', '[CRM_TEST_ONLY]候选人甲');
      await b.click('.tab', '跟进记录');
      await b.wait(text('[CRM_TEST_ONLY]增员跟进'));
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.name==='recruit_followups').candidate_id"), 930001);
    });
    for (const [key, route, name, fn] of [
      ['customers', '#/customers/trash', '[CRM_TEST_ONLY]已删除客户', 'customers'],
      ['recruit', '#/recruit/trash', '[CRM_TEST_ONLY]已删除候选人', 'recruit_candidates']
    ]) {
      await check('recycle.' + key, '回收站只读展示：' + key, async () => {
        await open(route, name);
        await b.wait(called(fn, 'trashList'));
        await b.wait(text('2026-09-20 01:00'));
        assert.equal(await b.evaluate("[...document.querySelectorAll('#view button')].find(e=>e.textContent.includes('批量恢复')).disabled"), true);
      });
    }
    for (const [key, route, expected] of [
      ['customers', '#/customers', '暂无客户'], ['activities', '#/activities', '暂无活动'],
      ['recycle', '#/customers/trash', '回收站为空'], ['funnels', '#/funnels', '漏斗为空']
    ]) await check('empty.' + key, '空数据状态：' + key, () => open(route, expected, 'mode=empty'));
    for (const [key, route, api, tab] of [
      ['customer', '#/customer/910001', 'customers:get'], ['activities', '#/activities', 'activities:list'],
      ['activity', '#/activity/940001', 'activities:get'], ['recruit', '#/recruit/930001', 'recruit_candidates:get'],
      ['funnels', '#/funnels', 'funnel_insight:stats'], ['opportunities', '#/customer/910001', 'opportunities:list', '经营机会']
    ]) await check('error.' + key, '接口错误可见：' + key, async () => {
      await b.open(route, 'mode=error&fail=' + encodeURIComponent(api));
      if (tab) { await b.wait(text('总览')); await b.click('.tab', tab); }
      await b.wait(text('TEST_API_FAILURE'));
    });
    await check('quickcapture.preserve', '快速录入点击背景保留草稿', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户甲');
      await b.evaluate("document.getElementById('qc-entry-btn').click()");
      await b.wait("Boolean(document.querySelector('.modal-overlay textarea'))");
      await b.evaluate("document.querySelector('.modal-overlay textarea').value='[CRM_TEST_ONLY]未保存草稿'; document.querySelector('.modal-overlay').click()");
      assert.equal(await b.evaluate("document.querySelector('.modal-overlay textarea')?.value"), '[CRM_TEST_ONLY]未保存草稿');
    });
  } finally { await b.close(); }
};
