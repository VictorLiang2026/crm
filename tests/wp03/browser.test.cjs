'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('scene UI requires preview and human confirmation, opens existing scene and rejects unauthorized access',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');await b.wait("document.getElementById('view').innerText.includes('测试场景')");
  await b.evaluate(`(async()=>{
   history.replaceState(null,'','#/test-scenario');window.wp03Calls=[];window.wp03Ready=false;
   const m=await import('/crm/js/modules/test-scenario.js');
   window.wp03Mount=forbidden=>m.renderTestScenario({root:document.getElementById('view'),callFn:async(name,e)=>{
    window.wp03Calls.push(e);if(forbidden)return {ok:false,error:{code:'SEED_FORBIDDEN'}};
    if(e.stage==='execute')window.wp03Ready=true;
    return {ok:true,ready:window.wp03Ready,initialCount:window.wp03Ready?10:0,derivedCount:0,auditCount:0,
     targets:{personId:'91',customerId:'92',activityId:'93'},previewId:'00000000-0000-4000-8000-000000000003',previewHash:'a'.repeat(32),
     identity:{name:'【系统测试·勿联系】虚构体验甲',decision:'confirm_new'},preview:{rows:[{table:'persons',count:1}],triggerBusinessRows:0,initialNew:10,initialTotal:10,maximum:10}};
   }});window.wp03Mount(false);
  })()`);
  await b.wait("[...document.querySelectorAll('#view button')].find(b=>b.textContent.includes('预览生成')).disabled===false");
  assert.equal(await b.evaluate("[...document.querySelectorAll('#view button')].find(b=>b.textContent.includes('3.')).disabled"),true);
  await b.click('#view button','1.');await b.wait("document.getElementById('view').innerText.includes('同步触发器额外业务行：0')");
  assert.equal(await b.evaluate("window.wp03Calls.some(e=>e.stage==='execute')"),false);
  await b.click('#view button','2.');await b.wait("document.getElementById('view').innerText.includes('已确认。')");
  await b.click('#view button','3.');await b.wait("document.getElementById('view').innerText.includes('初始样本 10 / 10')");
  assert.equal(await b.evaluate("document.querySelector('#view a[href=\"#/test-scenario/action\"]').textContent"),'预填下一步行动');
  assert.deepEqual(await b.evaluate("window.wp03Calls.map(e=>e.stage)"),['status','dryRun','confirm','execute']);
  await b.evaluate('window.wp03Mount(true)');await b.wait("document.getElementById('view').innerText.includes('仅供已授权测试账号')");
  assert.equal(await b.evaluate("[...document.querySelectorAll('#view button')].every(b=>b.disabled)"),true);
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
