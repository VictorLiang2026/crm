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
    await check('person360.opportunities', 'Person 360 显示旧客户及 Person 专属机会', async () => {
      await b.wait(called('person_360', 'listOpportunities'));
      await b.wait(text('[CRM_TEST_ONLY]联系候选人'));
      assert.equal(await b.evaluate("document.querySelectorAll('.person360-opportunity').length"), 2);
      assert.equal(await b.evaluate("document.querySelectorAll('.person360-opportunity a').length"), 1);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['createOpportunity','updateOpportunity'].includes(c.action))"), false);
    });
    await check('person360.insurance', 'Person 360 分源显示六块只读保险概览，旧保单检视入口保留', async () => {
      await b.wait(called('person_360', 'getInsuranceContext'));
      for (const label of ['Existing Coverage', 'Review', 'Known Needs', 'Potential Gaps', 'Open Opportunities', 'Next Actions']) {
        assert.equal(await b.evaluate(text(label)), true);
      }
      assert.equal(await b.evaluate(text('[CRM_TEST_ONLY]核对保障')), true);
      assert.equal(await b.evaluate("document.querySelector('.person360-insurance a').getAttribute('href')"), '#/customer/910001');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='getInsuranceContext')"), true);
    });
    await check('person360.opportunity-create', 'Person 机会先人工填写再通过登录接口创建', async () => {
      await b.click('.person360-opportunities button', '新增 Person 机会');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='createOpportunity')"), false);
      await b.evaluate("document.querySelector('.person360-opportunity-form select').value='speaker'; document.querySelector('.person360-opportunity-form input[type=text]').value='[CRM_TEST_ONLY]邀请嘉宾'");
      await b.click('.person360-opportunity-form button', '保存机会');
      await b.wait(called('person_360', 'createOpportunity'));
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.action==='createOpportunity').payload.opportunity_type"), 'speaker');
    });
    await check('person360.opportunity-edit', 'Person 专属机会可编辑，旧客户机会仅跳转原详情', async () => {
      await b.wait(text('[CRM_TEST_ONLY]联系候选人'));
      await b.click('.person360-opportunity button', '编辑');
      await b.evaluate("document.querySelector('.person360-opportunity-form input[type=text]').value='[CRM_TEST_ONLY]更新行动'");
      await b.click('.person360-opportunity-form button', '保存机会');
      await b.wait(called('person_360', 'updateOpportunity'));
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.action==='updateOpportunity').id"), 961001);
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
    await check('customer.policy-review', '原客户详情的保单检视页签和生成入口保留', async () => {
      await b.click('.tab', '保单检视');
      await b.wait(text('生成保单检视报告'));
      assert.equal(await b.evaluate("document.querySelectorAll('.prod-table').length"), 1);
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
      await b.wait(called('person_360', 'listDueCommitments'));
      await b.wait(text('[CRM_TEST_ONLY]已逾期承诺'));
      await b.wait(text('[CRM_TEST_ONLY]即将到期承诺'));
      await b.click('.coach-name', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('customers', 'get'));
      assert.equal(await b.evaluate('location.hash'), '#/customer/910001');
    });
    await check('today.action_fields', 'Today 五项输出和 Person 跳转', async () => {
      await open('#/today', '[CRM_TEST_ONLY]Action事项');
      await b.wait(text('预期目标：完成已记录行动并确认下一步'));
      await b.wait(text('准备：核对已有记录'));
      await b.wait(text('风险：先核实信息'));
      await b.click('.coach-item', '[CRM_TEST_ONLY]Action事项');
      await b.wait(called('person_360', 'get'));
      assert.equal(await b.evaluate('location.hash'), '#/person/980001');
    });
    await check('today.commitment_link', '承诺提醒可进入独立 Person 360', async () => {
      await open('#/today', '[CRM_TEST_ONLY]已逾期承诺');
      await b.click('#today-commitments a', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('person_360', 'get'));
      assert.equal(await b.evaluate('location.hash'), '#/person/980001');
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
    await check('activity.relationship-review-preview', '关系复盘只生成有来源的行动候选，不触发业务写入', async () => {
      await open('#/activity/940001', '[CRM_TEST_ONLY]客户甲', 'mode=activity-ended');
      await b.click('#view button', '关系复盘预览');
      await b.wait(called('ai_activity', 'postReviewV2'));
      await b.wait(text('[CRM_TEST_ONLY]核实需求'));
      assert.equal(await b.evaluate("document.querySelectorAll('.activity-review-v2-candidate').length"), 1);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['createOpportunity','createInteraction','createManual','recordActivityInteraction'].includes(c.action))"), false);
    });
    await check('activity.important-interaction', '重要互动必须填写结果与摘要并人工确认', async () => {
      await open('#/activity/940001', '[CRM_TEST_ONLY]客户甲');
      await b.click('#view a', '记录重要互动');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='recordActivityInteraction')"), false);
      await b.click('.modal-overlay button', '确认并保存互动');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='recordActivityInteraction')"), false);
      await b.evaluate("(() => { const modal=document.querySelector('.modal-overlay'); modal.querySelector('textarea').value='当面讨论保障需求并约定后续核对保单'; modal.querySelector('input[type=checkbox]').checked=true; })()");
      await b.click('.modal-overlay button', '确认并保存互动');
      await b.wait(called('person_360', 'recordActivityInteraction'));
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='recordActivityInteraction').payload");
      assert.equal(payload.activityId, 940001);
      assert.equal(payload.participantId, 970001);
      assert.equal(payload.eventType, 'invitation');
      assert.equal(payload.importance, 3);
      assert.equal(payload.confirmed, true);
    });
    await check('activity.person-first-add', '活动新增参与者先人工选择 Person 再提交', async () => {
      await b.click('#view button', '+ 添加参与者');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='addCanonicalParticipant')"), false);
      await b.evaluate("(() => { const input=document.querySelector('.modal-overlay input[type=text]'); input.value='[CRM_TEST_ONLY]客户甲'; input.dispatchEvent(new Event('input',{bubbles:true})); })()");
      await b.wait(called('person_360', 'resolveQuickCaptureName'));
      await b.wait("Boolean(document.querySelector('.modal-overlay .person-candidate'))");
      await b.click('.modal-overlay .person-candidate', '[CRM_TEST_ONLY]客户甲');
      await b.click('.modal-overlay button', '确认添加 Person');
      await b.wait(called('person_360', 'addCanonicalParticipant'));
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='addCanonicalParticipant').payload");
      assert.equal(payload.canonicalPersonId, '980001');
      assert.equal(payload.selectedDisplayName, '[CRM_TEST_ONLY]客户甲');
      assert.equal(payload.confirmed, true);
    });
    await check('speaker.person-first-create', '嘉宾专业档案先选择 Person 再保存', async () => {
      await open('#/speakers', '[CRM_TEST_ONLY]客户甲');
      await b.click('#view button', '+ 从 Person 新增嘉宾');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='createSpeakerProfile')"), false);
      await b.evaluate("(() => { const input=document.querySelector('.modal-overlay input[type=text]'); input.value='[CRM_TEST_ONLY]客户甲'; input.dispatchEvent(new Event('input',{bubbles:true})); })()");
      await b.wait("document.querySelectorAll('.modal-overlay button').length > 2");
      await b.click('.modal-overlay button', '[CRM_TEST_ONLY]客户甲');
      await b.click('.modal-overlay button', '确认选择 Person');
      await b.wait("document.querySelector('.modal-overlay [name=expertise]') !== null");
      await b.evaluate("document.querySelector('.modal-overlay [name=expertise]').value='[CRM_TEST_ONLY]保险讲座'");
      await b.click('.modal-overlay .modal-footer button', '确定');
      await b.wait(called('person_360', 'createSpeakerProfile'));
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='createSpeakerProfile').payload");
      assert.equal(payload.personId, '980001');
      assert.equal(payload.selectedDisplayName, '[CRM_TEST_ONLY]客户甲');
      assert.equal(payload.profile.expertise, '[CRM_TEST_ONLY]保险讲座');
      assert.equal(payload.confirmed, true);
    });
    await check('speaker.person-link', '旧嘉宾必须人工选择 Person 才能关联', async () => {
      await open('#/speakers', '[CRM_TEST_ONLY]客户甲');
      await b.click('#view a', '关联 Person');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='linkSpeakerPerson')"), false);
      await b.evaluate("(() => { const input=document.querySelector('.modal-overlay input[type=text]'); input.value='[CRM_TEST_ONLY]客户甲'; input.dispatchEvent(new Event('input',{bubbles:true})); })()");
      await b.wait("document.querySelectorAll('.modal-overlay button').length > 2");
      await b.click('.modal-overlay button', '[CRM_TEST_ONLY]客户甲');
      await b.click('.modal-overlay button', '确认选择 Person');
      await b.wait(called('person_360', 'linkSpeakerPerson'));
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='linkSpeakerPerson').payload");
      assert.equal(payload.speakerId, 990010);
      assert.equal(payload.personId, '980001');
      assert.equal(payload.confirmed, true);
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
      assert.equal(await b.evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='快速记录 V2')"), false);
      await b.evaluate("document.getElementById('qc-entry-btn').click()");
      await b.wait("Boolean(document.querySelector('.modal-overlay textarea'))");
      await b.evaluate("document.querySelector('.modal-overlay textarea').value='[CRM_TEST_ONLY]未保存草稿'; document.querySelector('.modal-overlay').click()");
      assert.equal(await b.evaluate("document.querySelector('.modal-overlay textarea')?.value"), '[CRM_TEST_ONLY]未保存草稿');
    });
    await check('quickcapture.v2.confirm', 'V2 默认隔离，手选 Person 并编辑后才提交允许的候选项', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户甲', 'v2=1');
      await b.wait("[...document.querySelectorAll('button')].some(x=>x.textContent==='快速记录 V2')");
      await b.click('button', '快速记录 V2');
      await b.wait("Boolean(document.querySelector('.qcv2-modal>textarea'))");
      await b.evaluate("document.querySelector('.qcv2-modal>textarea').value='[CRM_TEST_ONLY]原话'");
      await b.click('button', '解析为草稿');
      await b.wait("document.querySelector('.qcv2-preview')?.innerText.includes('事实候选')");
      assert.equal(await b.evaluate(called('person_360', 'commitQuickCaptureV2')), false);
      await b.click('button', '确认身份与内容并保存');
      await b.wait("document.querySelector('.qcv2-status')?.textContent.includes('手动选择')");
      assert.equal(await b.evaluate(called('person_360', 'commitQuickCaptureV2')), false);
      await b.click('button', '查找 Person');
      await b.wait("Boolean(document.querySelector('.qcv2-match input'))");
      await b.evaluate("document.querySelector('.qcv2-match input').click(); document.querySelector('.qcv2-preview section:nth-of-type(3) textarea').value='[CRM_TEST_ONLY]人工编辑的事实'; window.confirm=()=>true");
      await b.click('button', '确认身份与内容并保存');
      await b.wait("document.querySelector('.qcv2-success')?.textContent.includes('已保存互动')");
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='commitQuickCaptureV2')?.payload");
      assert.equal(payload.personId, '980001');
      assert.deepEqual(payload.facts, ['[CRM_TEST_ONLY]人工编辑的事实']);
      assert.deepEqual(payload.signals, ['[CRM_TEST_ONLY]观察线索']);
      assert.equal('opportunityCandidates' in payload, false);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='create' && ['opportunities','followups'].includes(c.name))"), false);
    });
  } finally { await b.close(); }
};
