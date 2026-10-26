'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('P3 legacy customer advice page keeps history but has no generate, edit, or completion controls',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/customer/910001','authCase=1&mode=p3-advice');
  await b.wait("document.querySelector('.tab')");
  await b.click('.tab','AI 建议');
  await b.wait("document.getElementById('view')?.innerText.includes('historical advice')");
  const text=await b.evaluate("document.getElementById('view').innerText");
  assert.match(text,/historical advice/);
  assert.match(text,/旧建议只读归档/);
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('#view button')].filter(x=>/生成 AI 跟进建议|保存修改|完成|跳过/.test(x.textContent)&&getComputedStyle(x).display!=='none'&&!x.disabled).map(x=>x.textContent)"),[]);
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='ai_recommend'||c.name==='ai_recommendations'&&['update','update_status'].includes(c.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
