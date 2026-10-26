'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('activity preparation shows audited advice and requires manual task entry in both languages',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');
  await b.evaluate(`(async()=>{
    const {data}=await import('/crm/js/modules/console/data.js');
    window.p3prepare={calls:[]};
    data.activityPrepareV2=async(ctx,id,mode,language)=>{p3prepare.calls.push({id,mode,language});return {result_id:92,business_data_written:false,plan:{brief:'[CRM_TEST_ONLY] Brief',checklist:['Confirm room'],outreach:['Invite guests'],risks:['Weather']}}};
    const {renderActivityPreparation}=await import('/crm/js/modules/console/activity-preparation.js');
    document.body.append(renderActivityPreparation({},940001,'preparing'));
  })()`);
  await b.click('.act-ai-prepare button','生成筹备建议');
  await b.wait("document.querySelector('.act-ai-prepare-result')?.textContent.includes('Confirm room')");
  assert.match(await b.evaluate("document.querySelector('.act-ai-prepare').innerText"),/AI 结果编号 #92/);
  assert.match(await b.evaluate("document.querySelector('.act-ai-prepare').innerText"),/人工录入/);
  assert.deepEqual(await b.evaluate('window.p3prepare.calls'),[{id:940001,mode:'prepare',language:'zh-CN'}]);
  await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');const {renderActivityPreparation}=await import('/crm/js/modules/console/activity-preparation.js');document.querySelector('.act-ai-prepare').remove();document.body.append(renderActivityPreparation({},940001,'preparing'))})()`);
  assert.match(await b.evaluate("document.querySelector('.act-ai-prepare').innerText"),/AI Preparation Advice/);
  await b.click('.act-ai-prepare button','Break Down Tasks');
  await b.wait("window.p3prepare.calls.length===2");
  assert.deepEqual(await b.evaluate('window.p3prepare.calls[1]'),{id:940001,mode:'decompose',language:'en'});
  assert.equal(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
  await b.healthy();
 }finally{await b.close();}
});
