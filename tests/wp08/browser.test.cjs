'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('Person work item remains unchanged until human preview confirmation, then refreshes its state',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start(); await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {mountPersonWorkItems}=await import('/crm/js/modules/work-items.js');
      localStorage.setItem('todayCoachCache','stale');
      window.wp08Events=[];
      window.wp08Row={id:7,person_id:783,kind:'action',title:'【系统测试·勿联系】整理反馈',
        description:'仅作演示',due_at:'2026-10-01T01:00:00Z',status:'open',priority:'medium',
        source:'ai_quick_capture_v2',interaction_id:7,updated_at:'2026-10-04T00:00:00Z'};
      window.wp08Call=async(_name,event)=>{
        wp08Events.push(event.action);
        if(event.action==='listPersonWorkItems')return {rows:[{...wp08Row}],hasMore:false,
          testData:{status:'verified',containsTestData:true,recordCount:1,
            sources:[{batchKey:'crm_test_main_v1',table:'actions',count:1}]}};
        if(event.action==='previewWorkItem')return {previewId:'a4825230-1d16-408f-9823-c49e99152d79',
          status:'preview',expiresAt:'2026-10-04T15:00:00+08:00',preview:{kind:'action',
            personName:'【系统测试·勿联系】虚构体验甲',before:{title:wp08Row.title,status:'open'},
            after:{status:'completed'}}};
        if(event.action==='executeWorkItem'){
          wp08Row={...wp08Row,status:'completed',completed_at:'2026-10-04T07:00:00Z'};
          return {kind:'action',itemId:7,replayed:false};
        }
        throw Error('Unexpected call');
      };
      mountPersonWorkItems({root:document.getElementById('view'),personId:783,
        personName:'【系统测试·勿联系】虚构体验甲',callFn:wp08Call,isCurrent:()=>true});
    })()`);
    await browser.wait("document.querySelector('.wi-row')?.innerText.includes('已逾期')");
    assert.equal(await browser.evaluate("document.querySelector('.wi-list').innerText.includes('含测试数据')"),true);
    assert.equal(await browser.evaluate("document.querySelector('.wi-source')?.getAttribute('href')"),'#/person/783');
    await browser.click('.wi-row button','完成');
    await browser.wait("document.querySelector('.wi-preview')?.innerText.includes('服务端预览')");
    assert.deepEqual(await browser.evaluate('wp08Events'),['listPersonWorkItems','previewWorkItem']);
    assert.equal(await browser.evaluate('wp08Row.status'),'open');
    await browser.click('.wi-preview button','确认以上内容并执行');
    await browser.wait("document.querySelector('.wi-row')?.innerText.includes('已完成')");
    assert.equal(await browser.evaluate('wp08Row.status'),'completed');
    assert.equal(await browser.evaluate("localStorage.getItem('todayCoachCache')"),null);
    assert.equal(await browser.evaluate("wp08Events.filter(x=>x==='executeWorkItem').length"),1);
    await browser.send('Emulation.setDeviceMetricsOverride',
      {width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
    assert.equal(await browser.evaluate("!!document.querySelector('.wi-row .wi-controls button')"),true);
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.healthy(); assert.deepEqual(browser.networkViolations,[]);
  }finally{await browser.close();}
});
