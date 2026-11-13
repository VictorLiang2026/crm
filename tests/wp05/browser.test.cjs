'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('Person profile uses one Person editor and retains profile access and test safety',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/person/980001');
  await b.wait("document.querySelector('.person360-toolbar')?.innerText.includes('编辑人物资料')");
  assert.equal(await b.evaluate("document.querySelectorAll('.person360-profile input,.person360-profile textarea,.person360-profile select').length"),0);
  assert.equal(await b.evaluate("[...document.querySelectorAll('.person360-profile button')].filter(b=>b.textContent.startsWith('复制')).every(b=>b.disabled)"),true);
  assert.equal(await b.evaluate("document.querySelector('.person360-profile').innerText.includes('含测试数据')"),true);
  for(const [width,height] of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
   assert.equal(await b.evaluate("(()=>{const p=document.querySelector('.person360-profile'),r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1&&r.right<=innerWidth+1})()"),true);
  }
  await b.click('.person360-toolbar button','编辑人物资料');
  await b.wait("document.querySelector('.modal')?.innerText.includes('人物信息')");
  const personFields=await b.evaluate("document.querySelector('.modal')?.innerText||''");
  for(const field of ['手机','来源','爱好','客户阶段','销售优先级','转介绍优先级','婚姻','首次接触日期'])assert.ok(personFields.includes(field),`missing Person field: ${field}`);
  assert.equal(personFields.includes('招募优先级'),false);
  await b.click('.modal button','取消');
  await b.open('#/person/980001');await b.wait("document.querySelector('.person360-profile')?.innerText.includes('编辑客户画像')");
  await b.click('.person360-profile a','编辑客户画像');await b.wait("document.querySelector('.tab.active')?.textContent==='客户画像'");
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
test('profile errors retry; no-link and stale-navigation fixtures never expose a second editor',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/ai','authCase=1');
  await b.wait("document.querySelector('#console-main .ai-assistant-links')");
  await b.evaluate(`(async()=>{
    const {renderPersonProfile}=await import('/crm/js/modules/person-profile.js');
    window.mountProfile=(mode)=>renderPersonProfile({root:document.getElementById('console-main'),personId:71,
      isCurrent:()=>mode!=='stale',callFn:async()=>{
       if(mode==='error')throw Error('fixture failure');
       return {personId:'71',customerId:null,status:mode==='deleted'?'customer_unavailable':'person_only',
        fields:{customer_name:'【系统测试·勿联系】虚构独立人物',additional_info:'<img src=x onerror=alert(1)>'},roles:[],contactAllowed:false,
        testData:{status:'unverified',containsTestData:null}};
      }});await window.mountProfile('error');
  })()`);
  assert.equal(await b.evaluate("document.getElementById('console-main').innerText.includes('重试资料')"),true);
  await b.evaluate("window.mountProfile('person')");
  assert.equal(await b.evaluate("document.querySelectorAll('#console-main a,#console-main input,#console-main textarea,#console-main img').length"),0);
  assert.equal(await b.evaluate("[...document.querySelectorAll('#console-main button')].every(x=>x.disabled)"),true);
  await b.evaluate("window.mountProfile('deleted')");
  assert.equal(await b.evaluate("document.getElementById('console-main').innerText.includes('移入回收站')"),true);
  await b.evaluate("window.mountProfile('stale')");
  assert.equal(await b.evaluate("document.getElementById('console-main').innerText.includes('虚构独立人物')"),false);
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
