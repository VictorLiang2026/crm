'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('M02 refresh confirms before navigation and preserves settings, route and storage',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try{
    await b.start();
    await b.openConsole('#/settings','authCase=1');
    await b.wait("document.querySelector('.settings-advanced')");
    assert.equal(await b.evaluate("document.querySelector('.settings-advanced').open"),false);
    assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.settings-advanced a')].map(x=>x.getAttribute('href'))"),['/crm/admin.html#/account','/crm/admin.html#/test-scenario']);
    await b.evaluate(`(()=>{
      localStorage.setItem('m02-preserve','local-fixture');
      sessionStorage.setItem('m02-session-preserve','session-fixture');
      window.m02Confirms=[];
      window.confirm=message=>{window.m02Confirms.push(message);return false};
      [...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('强制加载最新版')).click();
    })()`);
    assert.equal(await b.evaluate("new URL(location.href).searchParams.has('_fresh')"),false);
    assert.equal(await b.evaluate('window.m02Confirms.length'),1);
    assert.match(await b.evaluate('window.m02Confirms[0]'),/尚未保存/);
    assert.equal(await b.evaluate("localStorage.getItem('m02-preserve')"),'local-fixture');
    await b.evaluate("document.querySelector('.settings-advanced summary').click()");
    assert.equal(await b.evaluate("document.querySelector('.settings-advanced').open"),true);
    for(const [width,height] of [[820,1180],[1180,820]]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
      assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    }
    await b.evaluate("[...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('English')).click()");
    await b.wait("document.querySelector('.settings-advanced summary')?.textContent.includes('Legacy Maintenance')");
    await b.evaluate(`(()=>{
      window.confirm=message=>{window.m02ConfirmEnglish=message;return false};
      [...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('Force Reload Latest')).click();
    })()`);
    assert.match(await b.evaluate('window.m02ConfirmEnglish'),/Unsaved input/);
    await b.evaluate(`(()=>{
      window.confirm=()=>true;
      [...document.querySelectorAll('#console-main button')].find(x=>x.textContent.includes('Force Reload Latest')).click();
    })()`);
    await b.wait("new URL(location.href).searchParams.has('_fresh') && document.querySelector('.settings-password-form')");
    assert.equal(await b.evaluate('location.hash'),'#/settings');
    assert.equal(await b.evaluate("new URL(location.href).searchParams.get('authCase')"),'1');
    assert.equal(await b.evaluate("localStorage.getItem('crm_lang')"),'en');
    assert.equal(await b.evaluate("localStorage.getItem('m02-preserve')"),'local-fixture');
    assert.equal(await b.evaluate("sessionStorage.getItem('m02-session-preserve')"),'session-fixture');
    assert.equal(await b.evaluate('window.__crmTest.signOutAttempts'),0);
    assert.equal(await b.evaluate('window.__crmTest.passwordChanges'),0);
    assert.equal(await b.evaluate("document.querySelector('.settings-advanced').open"),false);
    assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>['create','update','execute','remove','restore'].includes(c.action))"),false);
    await b.healthy();
  }finally{await b.close();}
});
