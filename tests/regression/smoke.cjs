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
    await check('phase14.navigation', '七项主导航和全局快速记录始终可见', async () => {
      await open('#/today', '今日');
      const labels = await b.evaluate("[...document.querySelectorAll('#mod-switch button')].map(x=>x.textContent.trim())");
      assert.deepEqual(labels, ['今日', 'AI助手', '人', '机会', '活动', '招募', '更多']);
      assert.equal(await b.evaluate("document.getElementById('qc-entry-btn')?.textContent.includes('快速记录')"), true);
      assert.equal(await b.evaluate("document.querySelector('#mod-switch [data-mod=today]')?.classList.contains('active')"), true);
    });
    await check('phase14.people', '人物目录以只读方式进入 Person 360', async () => {
      await open('#/people', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('person_360', 'listPeople'));
      assert.equal(await b.evaluate("document.querySelector('#mod-switch [data-mod=people]')?.classList.contains('active')"), true);
      await b.click('#view a', '[CRM_TEST_ONLY]客户甲');
      await b.wait(called('person_360', 'get'));
      assert.equal(await b.evaluate('location.hash'), '#/person/980001');
      await b.wait(text('查看传统客户详情'));
    });
    await check('phase14.opportunities', '机会目录包含 Person 专属机会和人工入口', async () => {
      await open('#/opportunities', '[CRM_TEST_ONLY]联系候选人');
      await b.wait(called('person_360', 'listOpportunityDirectory'));
      assert.equal(await b.evaluate("document.querySelector('#mod-switch [data-mod=opportunities]')?.classList.contains('active')"), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='opportunities' && c.action==='create')"), false);
    });
    await check('phase14.ai-more', 'AI助手与更多保留旧入口', async () => {
      await open('#/ai', 'AI CRM 搜索');
      await open('#/more', '传统客户列表');
      for (const textLabel of ['传统跟进', '经营漏斗', 'AI建议历史', '保单检视', '产品',
        '伴手礼', '照片/OCR', '嘉宾资源', '主题资源', '招募目标', '客户活动量',
        '增员活动量', '客户回收站', '增员回收站']) {
        assert.equal(await b.evaluate(`document.getElementById('view').innerText.includes(${JSON.stringify(textLabel)})`), true);
      }
      await open('#/more/followups', '[CRM_TEST_ONLY]客户甲');
      await b.click('#view button', '打开传统跟进');
      await b.wait(text('[CRM_TEST_ONLY]跟进内容'));
      assert.equal(await b.evaluate('location.hash'), '#/customer/910001');
    });
    await check('ai.search.entry', 'AI CRM 搜索独立页面展示固定示例，进入页面不执行搜索', async () => {
      await open('#/ai/search', 'AI CRM 搜索');
      await b.wait(text('最近三个月参加过活动'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.action!=='testSamples')"), false);
    });
    await check('assistant.action.create', 'Action 必须人工选人、预览、确认后才执行', async () => {
      await open('#/assistant/actions/new', '新建行动');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.action==='command')"), false);
      await b.evaluate("document.querySelector('.crm-action-search input').value='[CRM_TEST_ONLY]家人乙'");
      await b.click('.crm-action-search button', '查找人物');
      await b.wait(text('[CRM_TEST_ONLY]家人乙 · #980002'));
      await b.click('.crm-action-choices button', '[CRM_TEST_ONLY]家人乙');
      await b.evaluate("document.querySelector('.crm-action-field input').value='[CRM_TEST_ONLY]联系'");
      await b.click('.crm-action-form button', '1. 规划');
      await b.wait(called('assistant', 'command'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.stage==='execute')"), false);
      await b.click('.crm-action-progress button', '2. 查看预览');
      await b.wait(text('标题：[CRM_TEST_ONLY]联系'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.stage==='execute')"), false);
      await b.click('.crm-action-progress button', '3. 确认预览');
      await b.wait(text('已确认预览'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.stage==='execute')"), false);
      await b.click('.crm-action-progress button', '4. 执行创建');
      await b.wait(text('行动已创建：#990777'));
      assert.equal(await b.evaluate("window.__crmTest.calls.filter(c=>c.name==='assistant' && c.stage==='execute').length"), 1);
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
    await check('person360.relationship-decay', '关系节奏候选只读显示依据、置信度与人工建议', async () => {
      await b.wait(called('person_360', 'getRelationshipDecay'));
      await b.wait(text('建议关注（待人工核实）'));
      for (const label of ['依据：', '建议行动：', '置信度：65%', '客户优先级代用']) {
        assert.equal(await b.evaluate(text(label)), true);
      }
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='getRelationshipDecay' && c.personId==='980001')"), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='actions' || c.action==='createAction')"), false);
    });
    await check('person360.opportunities', 'Person 360 显示旧客户及 Person 专属机会', async () => {
      await b.wait(called('person_360', 'listOpportunities'));
      await b.wait(text('[CRM_TEST_ONLY]联系候选人'));
      assert.equal(await b.evaluate("document.querySelectorAll('.person360-opportunity').length"), 2);
      assert.equal(await b.evaluate("document.querySelectorAll('.person360-opportunity a').length"), 1);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['createOpportunity','updateOpportunity'].includes(c.action))"), false);
    });
    await check('person360.opportunity-candidate-preview', '机会候选显示来源；预览与取消确认不会创建正式机会', async () => {
      await open('#/person/980001', '[CRM_TEST_ONLY]客户主动询问保障', 'mode=candidate');
      await b.click('.opportunity-candidate-row button', '审核');
      await b.wait(text('public.interactions#990001'));
      await b.wait(text('[CRM_TEST_ONLY]主动询问保障'));
      await b.click('.opportunity-candidate-detail button', '预览正式创建');
      await b.wait(text('正式创建预览'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && c.operation==='preview')"), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && ['confirm','execute'].includes(c.operation))"), false);
      await b.click('.opportunity-candidate-preview button', '确认并创建正式机会');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='assistant' && ['confirm','execute'].includes(c.operation))"), false);
      await open('#/person/980001', '[CRM_TEST_ONLY]联系候选人');
    });
    await check('person360.recruit', 'Person 360 显示招募资料和原详情入口，只读加载', async () => {
      await b.wait(called('person_360', 'listRecruitContext'));
      await b.wait(text('[CRM_TEST_ONLY]增员沟通'));
      assert.equal(await b.evaluate("document.querySelector('.person360-recruit a').getAttribute('href')"), '#/recruit/930001');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='createInteraction')"), false);
    });
    await check('person360.insurance', 'Person 360 分源显示六块只读保险概览，旧保单检视入口保留', async () => {
      await b.wait(called('person_360', 'getInsuranceContext'));
      for (const label of ['Existing Coverage', 'Review', 'Known Needs', 'Potential Gaps', 'Open Opportunities', 'Next Actions']) {
        assert.equal(await b.evaluate(text(label)), true);
      }
      assert.equal(await b.evaluate(text('[CRM_TEST_ONLY]核对保障')), true);
      assert.equal(await b.evaluate(text('public.products#940001')), true);
      assert.equal(await b.evaluate(text('含测试数据')), true);
      assert.equal(await b.evaluate("document.querySelector('.person360-insurance a').getAttribute('href')"), '#/customer/910001');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360' && c.action==='getInsuranceContext')"), true);
      await b.click('.person360-insurance-source button', '打开来源');
      assert.equal(await b.evaluate('window.location.hash'), '#/customer/910001');
      await b.wait(text('保单检视'));
      await open('#/person/980001', '[CRM_TEST_ONLY]联系候选人');
    });
    await check('person360.insurance-unknown', '无保障资料时显示未知且不编造缺口', async () => {
      await b.evaluate("sessionStorage.setItem('crm_test_empty_insurance','1')");
      await open('#/people', '人物');
      await open('#/person/980001', '[CRM_TEST_ONLY]联系候选人');
      await b.wait(text('保障资料未知'));
      assert.equal(await b.evaluate(text('不能推断没有保障')), true);
      assert.equal(await b.evaluate("document.querySelectorAll('.person360-insurance-item').length"), 0);
      await b.evaluate("sessionStorage.removeItem('crm_test_empty_insurance')");
      await open('#/people', '人物');
      await open('#/person/980001', '[CRM_TEST_ONLY]联系候选人');
    });
    await check('person360.opportunity-create', 'Person 机会未确认时只生成服务端预览', async () => {
      await b.click('.person360-opportunities button', '新增 Person 机会');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='previewOpportunity')"), false);
      await b.evaluate("document.querySelector('.person360-opportunity-form select').value='speaker'; document.querySelector('.person360-opportunity-form input[type=text]').value='[CRM_TEST_ONLY]邀请嘉宾'");
      await b.click('.person360-opportunity-form button', '生成服务端预览');
      await b.wait(called('person_360', 'previewOpportunity'));
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.action==='previewOpportunity').payload.draft.type"), 'speaker');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='executeOpportunity')"), false);
    });
    await check('person360.opportunity-edit', 'Person 专属机会经预览确认编辑，旧客户机会仅跳转原详情', async () => {
      await b.wait(text('[CRM_TEST_ONLY]联系候选人'));
      await b.click('.person360-opportunity button', '编辑');
      await b.evaluate("document.querySelector('.person360-opportunity-form input[type=text]').value='[CRM_TEST_ONLY]更新行动'");
      await b.click('.person360-opportunity-form button', '生成服务端预览');
      await b.wait(text('服务端预览'));
      assert.equal(await b.evaluate("window.__crmTest.calls.filter(c=>c.action==='previewOpportunity').at(-1).payload.opportunityId"), 961001);
      await b.click('.person360-opportunity-form button', '确认以上内容并执行');
      await b.wait(called('person_360', 'executeOpportunity'));
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='updateOpportunity')"), false);
    });
    await check('person360.opportunity-preview-error', 'CloudBase 拒绝非 Error 对象时显示可定位错误而非 undefined', async () => {
      await b.evaluate('window.__crmTest.rejectPreview=true');
      try {
        await b.click('.person360-opportunity button', '编辑');
        await b.click('.person360-opportunity-form button', '生成服务端预览');
        await b.wait(text('预览失败：SDK_NETWORK_TEST'));
        assert.equal(await b.evaluate("document.querySelector('.person360-opportunity-form-host').innerText.includes('undefined')"), false);
      } finally {
        await b.evaluate('window.__crmTest.rejectPreview=false');
      }
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
    await check('person360.relationship-decay-insufficient', '缺少依据时明确不判断且不显示伪造置信度', async () => {
      await open('#/person/980001', '证据不足，暂不判断', 'mode=empty');
      assert.equal(await b.evaluate(text('置信度：无法评估（证据不足）')), true);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='actions' || c.action==='createAction')"), false);
      await open('#/customer/910001', '[CRM_TEST_ONLY]预约沟通');
    });
    await check('customer.policy-review', '原客户详情的保单检视页签和生成入口保留', async () => {
      await b.click('.tab', '保单检视');
      await b.wait(text('生成保单检视报告'));
      assert.equal(await b.evaluate("document.querySelectorAll('.prod-table').length"), 1);
    });
    await check('customer.photos', '旧照片附件页签保留直接上传入口且进入时不写入', async () => {
      await b.click('.tab', '照片/附件');
      await b.click('#view button', '+ 添加照片/资料');
      await b.wait("document.getElementById('modal-root').innerText.includes('直接上传照片/附件')");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='photos' && c.action==='create')"), false);
      await b.click('.modal-footer button', '取消');
    });
    await check('customer.ocr', '旧 OCR 页签可读并保持空结果状态', async () => {
      await b.click('.tab', 'AI 解析记录');
      await b.wait(called('ocr_records', 'list'));
      await b.wait(text('暂无 AI 解析记录'));
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
      assert.equal(await b.evaluate("window.__crmTest.calls.find(c=>c.name==='customers' && c.action==='list').pageSize"), 50);
      await b.click('#view button', '下一页');
      await b.wait("document.querySelectorAll('#view tbody tr').length === 5");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='customers' && c.action==='list' && c.page===2)"), true);
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
    await check('today.morning_brief', '晨间事实自动显示七段，AI 建议按需请求且旧 Today 5 仍显示', async () => {
      await open('#/today', '[CRM_TEST_ONLY]今日行动');
      await b.wait(text('刷新事实'));
      await b.wait(text('[CRM_TEST_ONLY]晨间摘要'));
      for (const label of ['Morning Brief', 'Top Actions', 'Commitments', 'Upcoming',
        'Risk', 'Opportunities', 'Need Confirmation']) await b.wait(text(label));
      await b.wait(text('[CRM_TEST_ONLY]待审核依据'));
      await b.wait(text('[CRM_TEST_ONLY]今日行动'));
      assert.equal(await b.evaluate("window.__crmTest.calls.filter(c=>c.name==='today_coach' && c.action==='daily_review' && c.view==='morning' && c.guidance==='rules').length"), 1);
      await b.click('#today-morning-brief button', '获取 AI 工作建议');
      await b.wait("window.__crmTest.calls.some(c=>c.name==='today_coach' && c.action==='daily_review' && c.view==='morning' && c.guidance==='ai')");
      assert.equal(await b.evaluate("window.__crmTest.calls.filter(c=>c.name==='today_coach' && c.action==='daily_review' && c.view==='morning' && c.guidance==='ai').length"), 1);
      await b.click('#today-morning-brief .mb-section .mb-link', '[CRM_TEST_ONLY]今日行动');
      await b.wait(called('person_360','listPersonWorkItems'));
      assert.equal(await b.evaluate('location.hash'), '#/person/980001');
      assert.equal(await b.evaluate("Boolean(document.getElementById('work-action-990301'))"), true);
    });
    await check('today.test_agenda', '虚构场景一键进入普通 Today 并自动读取晨间事实', async () => {
      await open('#/test-scenario', '一键打开测试日程', 'v2=1');
      await b.click('#view a', '一键打开测试日程');
      await b.wait(text('已打开普通 Today，测试记录以来源提示为准'));
      await b.wait(text('Morning Brief'));
      assert.equal(await b.evaluate('location.hash'), '#/today');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='today_coach' && c.action==='daily_review' && c.view==='morning' && c.guidance==='rules')"), true);
    });
    await check('today.legacy_review', '旧版今日复盘入口与返回字段继续可用', async () => {
      await open('#/today', '[CRM_TEST_ONLY]今日行动');
      await b.click('#view button', '今日复盘');
      await b.wait(text('[CRM_TEST_ONLY]旧版经营复盘'));
      await b.wait(text('AI 经营复盘（今日）'));
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
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='executeIdentity')"), false);
      await b.evaluate("(() => { const input=document.querySelector('.modal-overlay input[type=text]'); input.value='[CRM_TEST_ONLY]客户甲'; input.dispatchEvent(new Event('input',{bubbles:true})); })()");
      await b.wait("document.querySelectorAll('.modal-overlay button').length > 2");
      await b.click('.modal-overlay button', '[CRM_TEST_ONLY]客户甲');
      await b.click('.modal-overlay button', '确认选择 Person');
      await b.wait("document.querySelector('.modal-overlay [name=expertise]') !== null");
      await b.evaluate("document.querySelector('.modal-overlay [name=expertise]').value='[CRM_TEST_ONLY]保险讲座'");
      await b.evaluate('window.confirm=()=>true');
      await b.click('.modal-overlay .modal-footer button', '确定');
      await b.wait(called('person_360', 'executeIdentity'));
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='previewIdentity').payload");
      assert.equal(payload.personId, '980001');
      assert.equal(payload.displayName, '[CRM_TEST_ONLY]客户甲');
      assert.equal(payload.kind, 'speaker');
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='activity_speakers'&&c.action==='update'&&c.payload.expertise==='[CRM_TEST_ONLY]保险讲座')"),true);
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
    await check('recruit.customer-lookup', '新增候选人通过有上限的服务端查询选择客户', async () => {
      await b.click('#view button', '+ 新增候选人');
      await b.evaluate("(() => { const x=document.querySelector('input[placeholder=\"输入客户姓名…\"]'); x.value='[CRM_TEST_ONLY]客户甲'; x.dispatchEvent(new Event('blur')); })()");
      await b.wait("document.body.innerText.includes('✓ 已关联客户：[CRM_TEST_ONLY]客户甲')");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='customers' && c.action==='list' && c.exactName==='[crm_test_only]客户甲' && c.pageSize===1)"), true);
      await b.click('body .card button', '取消');
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
      assert.equal(await b.evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='快速记录 V2' && x.style.display!=='none')"), false);
      await b.evaluate("document.getElementById('qc-entry-btn').click()");
      await b.wait("Boolean(document.querySelector('.modal-overlay textarea'))");
      await b.evaluate("document.querySelector('.modal-overlay textarea').value='[CRM_TEST_ONLY]未保存草稿'; document.querySelector('.modal-overlay').click()");
      assert.equal(await b.evaluate("document.querySelector('.modal-overlay textarea')?.value"), '[CRM_TEST_ONLY]未保存草稿');
    });
    await check('quickcapture.v2.confirm', 'V2 测试账号手选 Person、逐项编辑、服务端预览后写入', async () => {
      await open('#/customers', '[CRM_TEST_ONLY]客户甲', 'v2=1');
      await b.wait("[...document.querySelectorAll('button')].some(x=>x.textContent==='快速记录 V2' && x.style.display!=='none')");
      await b.click('button', '快速记录 V2');
      await b.wait("Boolean(document.querySelector('.qcv2-modal>textarea'))");
      await b.click('button', '使用预填测试场景');
      await b.click('button', '解析为草稿');
      await b.wait("document.querySelector('.qcv2-preview')?.innerText.includes('事实候选')");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='quickCaptureV2' && c.stage==='execute')"), false);
      await b.click('button', '生成服务端预览');
      await b.wait("document.querySelector('.qcv2-status')?.textContent.includes('手动选择')");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='quickCaptureV2' && c.stage==='plan')"), false);
      await b.click('button', '查找 Person');
      await b.wait("Boolean(document.querySelector('.qcv2-match input'))");
      await b.evaluate("document.querySelector('.qcv2-match input').click(); document.querySelector('.qcv2-preview section:nth-of-type(3) .qcv2-candidate textarea').value='【系统测试·勿联系】人工编辑的事实'; for(const n of [3,4,6,7]) document.querySelector('.qcv2-preview section:nth-of-type('+n+') .qcv2-candidate input').click(); document.querySelector('.qcv2-preview section:nth-of-type(7) select').value='MUTUAL'");
      await b.click('button', '生成服务端预览');
      await b.wait("document.querySelector('.qcv2-preview')?.innerText.includes('服务端预览')");
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='quickCaptureV2' && c.stage==='execute')"), false);
      await b.click('button', '确认以上内容并写入');
      await b.wait("document.querySelector('.qcv2-success')?.textContent.includes('已保存互动')");
      const payload = await b.evaluate("window.__crmTest.calls.find(c=>c.action==='quickCaptureV2' && c.stage==='plan')?.payload");
      assert.equal(payload.personId, '980001');
      assert.deepEqual(payload.draft.facts, ['【系统测试·勿联系】人工编辑的事实']);
      assert.deepEqual(payload.draft.signals, ['【系统测试·勿联系】观察线索']);
      assert.equal(payload.draft.actions.length, 1);
      assert.equal(payload.draft.commitments[0].type, 'MUTUAL');
      assert.equal('opportunityCandidates' in payload.draft, false);
      assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.action==='create' && ['opportunities','followups'].includes(c.name))"), false);
    });
  } finally { await b.close(); }
};
