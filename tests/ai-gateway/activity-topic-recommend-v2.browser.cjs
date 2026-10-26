'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('topic advice only selects a local checkbox until the operator saves', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.evaluate(`(async()=>{
      const {data}=await import('/crm/js/modules/console/data.js');
      window.topicAdviceCalls=[]; window.topicWrites=[];
      data.activityDetail=async()=>({activity:{id:940001,status:'preparing',topic_ids:[],updated_at:'2026-10-27T00:00:00Z'},participants:[]});
      data.activitySpeakers=async()=>({rows:[]});
      data.activityTopics=async()=>({rows:[{id:8,topic_name:'[CRM_TEST_ONLY] Health',status:'active',use_count:1}]});
      data.activityRecommendTopicsV2=async(ctx,id,language)=>{topicAdviceCalls.push({id,language});return {
        result_id:92,business_data_written:false,requires_confirmation:true,
        recommendations:[{topic_id:8,topic_name:'[CRM_TEST_ONLY] Health',score:87,reason:'Fits audience'}]};};
      data.applyActivityTopics=async(...args)=>{topicWrites.push(args);return {ok:true};};
      const {renderActivityResources}=await import('/crm/js/modules/console/activity-people.js');
      document.body.append(await renderActivityResources({toast:()=>{}},940001));
    })()`);
    await browser.click('.act-ai-topic button', '生成主题建议');
    await browser.wait("document.querySelector('.act-ai-topic-results')?.textContent.includes('[CRM_TEST_ONLY] Health')");
    assert.deepEqual(await browser.evaluate('window.topicAdviceCalls'), [{ id: 940001, language: 'zh-CN' }]);
    assert.deepEqual(await browser.evaluate('window.topicWrites'), []);
    await browser.click('.act-ai-topic-results button', '勾选此主题');
    assert.equal(await browser.evaluate("document.querySelector('.act-topic-picks input')?.checked"), true);
    assert.deepEqual(await browser.evaluate('window.topicWrites'), []);
    await browser.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
      const {renderTopicRecommendations}=await import('/crm/js/modules/console/activity-topic-recommend.js');
      document.querySelector('.act-ai-topic').remove();
      document.body.append(renderTopicRecommendations({}, {id:940001,status:'preparing'}, ()=>{}));})()`);
    assert.match(await browser.evaluate("document.querySelector('.act-ai-topic').innerText"), /Topic Suggestions/);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await browser.healthy();
  } finally { await browser.close(); }
});
