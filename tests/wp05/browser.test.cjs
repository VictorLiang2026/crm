'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('Person profile uses one legacy editor and retains mobile access and test safety',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/person/980001');
  await b.wait("document.querySelector('.person360-profile')?.innerText.includes('编辑基本信息')");
  assert.equal(await b.evaluate("document.querySelectorAll('.person360-profile input,.person360-profile textarea,.person360-profile select').length"),0);
  assert.equal(await b.evaluate("[...document.querySelectorAll('.person360-profile button')].filter(b=>b.textContent.startsWith('复制')).every(b=>b.disabled)"),true);
  assert.equal(await b.evaluate("document.querySelector('.person360-profile').innerText.includes('含测试数据')"),true);
  for(const width of [360,390,768]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
   assert.equal(await b.evaluate("(()=>{const p=document.querySelector('.person360-profile'),r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1&&r.right<=innerWidth+1})()"),true);
  }
  await b.click('.person360-profile a','编辑基本信息');
  await b.wait("document.querySelector('.tab.active')?.textContent==='基本信息'");
  await b.click('#view button','编辑');await b.wait("document.querySelector('.modal')?.innerText.includes('编辑客户')");
  assert.equal(await b.evaluate("location.hash.startsWith('#/customer/')"),true);
  await b.click('.modal button','取消');
  await b.open('#/person/980001');await b.wait("document.querySelector('.person360-profile')?.innerText.includes('编辑客户画像')");
  await b.click('.person360-profile a','编辑客户画像');await b.wait("document.querySelector('.tab.active')?.textContent==='客户画像'");
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
test('profile errors retry; no-link and stale-navigation fixtures never expose a second editor',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');
  await b.evaluate(`(async()=>{
    const {renderPersonProfile}=await import('/crm/js/modules/person-profile.js');
    window.mountProfile=(mode)=>renderPersonProfile({root:document.getElementById('view'),personId:71,
      isCurrent:()=>mode!=='stale',callFn:async()=>{
       if(mode==='error')throw Error('fixture failure');
       return {personId:'71',customerId:null,status:mode==='deleted'?'customer_unavailable':'person_only',
        fields:{customer_name:'【系统测试·勿联系】虚构独立人物',additional_info:'<img src=x onerror=alert(1)>'},roles:[],contactAllowed:false,
        testData:{status:'unverified',containsTestData:null}};
      }});await window.mountProfile('error');
  })()`);
  assert.equal(await b.evaluate("document.getElementById('view').innerText.includes('重试资料')"),true);
  await b.evaluate("window.mountProfile('person')");
  assert.equal(await b.evaluate("document.querySelectorAll('#view a,#view input,#view textarea,#view img').length"),0);
  assert.equal(await b.evaluate("[...document.querySelectorAll('#view button')].every(x=>x.disabled)"),true);
  await b.evaluate("window.mountProfile('deleted')");
  assert.equal(await b.evaluate("document.getElementById('view').innerText.includes('移入回收站')"),true);
  await b.evaluate("window.mountProfile('stale')");
  assert.equal(await b.evaluate("document.getElementById('view').innerText.includes('虚构独立人物')"),false);
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 }finally{await b.close();}
});
