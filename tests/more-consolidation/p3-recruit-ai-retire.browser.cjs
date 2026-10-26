'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('P3 legacy recruit AI controls are archived while manual profile and score remain',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/recruit/930001','authCase=1');
  await b.wait("document.getElementById('view')?.innerText.includes('候选人画像')");
  const text=await b.evaluate("document.getElementById('view').innerText");
  assert.doesNotMatch(text,/AI 高潜评分/);
  await b.click('.tab','候选人画像');
  await b.wait("document.getElementById('view')?.innerText.includes('手动编辑')");
  const profile=await b.evaluate("document.getElementById('view').innerText");
  assert.match(profile,/手动编辑/);
  assert.doesNotMatch(profile,/✨ AI 补全画像/);
  await b.click('.tab','AI 增员话术');
  await b.wait("document.getElementById('view')?.innerText.includes('旧版增员话术入口已归档')");
  assert.equal(await b.evaluate("[...document.querySelectorAll('#view button')].some(x=>x.textContent.includes('生成 AI 增员话术'))"),false);
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['recruit_score','recruit_recommend','ai_followup'].includes(c.name))"),false);
  await b.healthy();
 }finally{await b.close();}
});
