'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M05 hub navigates to existing recycle pages without restoring records',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1&mode=pc35');
  await b.wait("document.querySelector('#console-main a[href=\"#/recycle\"]')");
  await b.evaluate("document.querySelector('#console-main a[href=\"#/recycle\"]').click()");
  await b.wait("document.querySelector('.recycle-hub')");
  assert.equal(await b.evaluate("document.querySelector('.recycle-legacy')===null"),true);
  for(const route of ['#/people-trash','#/recycle/customers','#/recycle/recruit']){
   await b.evaluate(`document.querySelector('.recycle-hub a[href="${route}"]').click()`);
   await b.wait("document.querySelector('#console-main a[href=\"#/recycle\"]')");
   assert.equal(await b.evaluate('location.hash'),route);
   await b.evaluate("document.querySelector('#console-main a[href=\"#/recycle\"]').click()");
   await b.wait("document.querySelector('.recycle-hub')");
  }
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.recycle-legacy a')].map(x=>x.getAttribute('href'))"),[]);
  await b.evaluate("localStorage.setItem('crm_lang','en')");
  await b.openConsole('#/recycle','authCase=1&mode=pc35');
  await b.wait("document.querySelector('.recycle-hub')");
  assert.match(await b.evaluate("document.querySelector('#console-main').innerText"),/Choose the record type/);
  for(const size of [{width:820,height:1180},{width:1180,height:820}]){
   await b.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>/restore|remove|delete/i.test(c.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
