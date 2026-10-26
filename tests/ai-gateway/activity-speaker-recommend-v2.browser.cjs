'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('speaker advice opens the existing Person selection flow without selecting identity or writing activity data', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.evaluate(`(async()=>{
      const {data}=await import('/crm/js/modules/console/data.js');
      window.speakerAdviceCalls=[];
      data.activityDetail=async()=>({activity:{id:940001,status:'preparing',topic_ids:[],updated_at:'2026-10-27T00:00:00Z'},participants:[]});
      data.activitySpeakers=async()=>({rows:[]}); data.activityTopics=async()=>({rows:[]});
      data.activityRecommendSpeakersV2=async(ctx,id,language)=>{speakerAdviceCalls.push({id,language});return {
        result_id:92,business_data_written:false,requires_confirmation:true,
        recommendations:[{speaker_id:8,person_id:88,speaker_name:'[CRM_TEST_ONLY] Speaker',
          score:87,reason:'Relevant expertise',suggested_topic:'Health',contact_suggestion:'Ask availability'}]};};
      data.addCanonicalParticipant=async()=>{throw Error('Unexpected write');};
      const {renderActivityResources}=await import('/crm/js/modules/console/activity-people.js');
      document.body.append(await renderActivityResources({toast:()=>{}},940001));
    })()`);
    await browser.click('.act-ai-speaker button', '生成嘉宾建议');
    await browser.wait("document.querySelector('.act-ai-speaker-results')?.textContent.includes('[CRM_TEST_ONLY] Speaker')");
    assert.deepEqual(await browser.evaluate('window.speakerAdviceCalls'), [{ id: 940001, language: 'zh-CN' }]);
    await browser.click('.act-ai-speaker-results button', '核实身份后添加');
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay input[type=search]')?.value"), '[CRM_TEST_ONLY] Speaker');
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay select.sheet-select')?.value"), 'speaker');
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary')?.disabled"), true);
    await browser.evaluate("document.querySelector('.sheet-overlay').remove()");
    await browser.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
      const {renderSpeakerRecommendations}=await import('/crm/js/modules/console/activity-speaker-recommend.js');
      document.querySelector('.act-ai-speaker').remove();
      document.body.append(renderSpeakerRecommendations({}, {id:940001,status:'preparing'}, ()=>{}));})()`);
    assert.match(await browser.evaluate("document.querySelector('.act-ai-speaker').innerText"), /Speaker Suggestions/);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await browser.healthy();
  } finally { await browser.close(); }
});
