'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('isolated browser shows source notice, preserves cards, uses plain text and clears stale flags',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try {
  await b.start();await b.open('#/funnels','wp02=mixed');
  await b.wait("document.getElementById('view').innerText.includes('含测试数据')");
  assert.equal(await b.evaluate("document.getElementById('view').innerText.includes('crm_test_wp_two / public.customers')"),true);
  await b.open('#/funnels','wp02=none');
  await b.wait("document.querySelectorAll('#view [data-crm-test-notice]').length === 0 && document.getElementById('view').innerText.includes('客户经营漏斗')");
  await b.open('#/funnels','wp02=unknown');
  await b.wait("document.getElementById('view').innerText.includes('测试数据标记暂未核验')");
  await b.evaluate("(async()=>{const m=await import('/crm/js/modules/test-data-notice.js');const box=document.createElement('div');box.id='wp02-xss';document.body.append(box);m.renderTestDataNotice(box,{status:'verified',containsTestData:true,recordCount:1,sources:[{batchKey:'<img src=x onerror=alert(1)>',table:'customers',count:1}]});})()");
  assert.equal(await b.evaluate("document.querySelector('#wp02-xss img') === null"),true);
  await b.healthy();assert.deepEqual(b.networkViolations,[]);
 } finally {await b.close();}
});

