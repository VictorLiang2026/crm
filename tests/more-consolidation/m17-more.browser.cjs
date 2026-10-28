'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('M17 More has four primary entries, explicit route kinds, justified compatibility and preserved capture',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();
  for(const lang of ['zh-CN','en']){
   await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
   await b.evaluate('localStorage.setItem("crm_lang",'+JSON.stringify(lang)+')');
   for(const[width,height]of[[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
    assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.more-primary a')].map(x=>x.getAttribute('href'))"),['#/knowledge-library','#/analytics','#/settings','#/recycle']);
    assert.equal(await b.evaluate("document.querySelector('.more-workspaces').open"),false);
    assert.equal(await b.evaluate("document.querySelector('.more-compat')"),null);
    assert.equal(await b.evaluate("[...document.querySelectorAll('#console-main details>summary')].every(x=>getComputedStyle(x).display==='list-item'&&x.getBoundingClientRect().height>=44)"),true);
    assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.more-compat a')].map(x=>x.getAttribute('href'))"),
      []);
    assert.equal(await b.evaluate("[...document.querySelectorAll('.more-compat a')].every(x=>x.dataset.entryKind==='legacy' && x.getAttribute('href').startsWith('/crm/admin.html#/') && x.querySelector('[data-compat-reason]').textContent.length>20)"),true);
    assert.equal(await b.evaluate("[...document.querySelectorAll('a[data-entry-kind=native]')].every(x=>x.getAttribute('href').startsWith('#/'))"),true);
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await b.evaluate("document.querySelector('#console-main').textContent.includes('m17_')"),false);
    if(lang==='en'){const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../security/.results/m17-'+width+'.png'),Buffer.from(shot.data,'base64'));}
    await b.evaluate("document.querySelector('.more-workspaces summary').click()");
    assert.equal(await b.evaluate("[...document.querySelectorAll('#console-main a[data-entry-kind]')].every(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.right<=innerWidth+1})"),true);
   }
  }
  // Preserve existing phone access, without introducing new phone layouts.
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-workspaces')");
  assert.equal(await b.evaluate("document.querySelector('.more-workspaces').open"),true);
  const knowledge=await b.evaluate(`(()=>{const a=document.querySelector('.more-primary a[href="#/knowledge-library"]');const r=a?.getBoundingClientRect();return {exists:!!a,visible:!!r&&r.width>0&&r.height>0&&r.right<=innerWidth+1,columns:getComputedStyle(document.querySelector('.more-primary .tile-grid')).gridTemplateColumns}})()`);
  assert.equal(knowledge.exists,true);assert.equal(knowledge.visible,true);assert.equal(knowledge.columns.split(' ').length,1);
  await b.evaluate("document.querySelector('.more-primary a[href=\\\"#/knowledge-library\\\"]').click()");
  await b.wait("location.hash==='#/knowledge-library'");
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  for(const hash of ['#/activities','#/recruit','#/ai'])assert.equal(await b.evaluate(`document.querySelector('.more-workspaces a[href="${hash}"]').getBoundingClientRect().width>0`),true);
  assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await b.evaluate("document.querySelector('[data-more-capture]').click()");
  await b.wait("document.querySelector('.qc-modal') || document.querySelector('.qc-overlay') || document.querySelector('.sheet-overlay')");
  assert.equal(await b.evaluate("window.__crmTest.calls.some(x=>['create','update','execute','delete','restore'].includes(x.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
