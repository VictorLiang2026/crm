'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

const existingName = '【系统测试·勿联系】虚构刘芬（儿科医生）';
const newName = '【系统测试·勿联系】虚构刘芬（上海外国语学校）';
const revisedName = '【系统测试·勿联系】虚构刘芬（外国语学校）';
const baseName = '【系统测试·勿联系】虚构刘芬';

test('manual Person creation keeps the candidate visible and previews a different qualifier', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {openPersonNew}=await import('/crm/js/modules/console/write.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('zh-CN');
      window.qualifiedName={calls:[],async call(api,args){
        this.calls.push({api,args});
        if(api==='person_360'&&args.action==='resolveIdentity')return {
          displayName:args.name,nameKey:${JSON.stringify(baseName)},status:'confirm_existing',
          hasMore:false,deletedIdentity:false,canCreateAfterConfirmation:args.name!==${JSON.stringify(existingName)},
          candidates:[{id:'671',displayName:${JSON.stringify(existingName)}}]};
        if(api==='person_360'&&args.action==='previewIdentity')return {
          previewId:'9a51651a-3487-4cd6-8260-e31b96ee41d0',preview:{newPerson:true}};
        throw Error('Unexpected call: '+api+' '+args.action);
      }};
      window.openQualifiedPerson=()=>openPersonNew({api:{call:(api,args)=>window.qualifiedName.call(api,args)},toast:()=>{}});
      window.openQualifiedPerson();
    })()`);
    await browser.evaluate(`(()=>{const input=document.querySelector('.sheet-overlay input');
      input.value=${JSON.stringify(newName)};document.querySelector('.sheet-overlay .btn-primary').click()})()`);
    await browser.wait("document.querySelector('.sheet-overlay .cand-wrap') !== null");
    assert.equal(await browser.evaluate(`document.querySelector('.sheet-overlay').innerText.includes(${JSON.stringify(existingName)})`), true);
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary') !== null"), true);
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary').click()");
    await browser.wait("window.qualifiedName.calls.some(c=>c.args.action==='previewIdentity')");
    const preview = await browser.evaluate("window.qualifiedName.calls.find(c=>c.args.action==='previewIdentity').args.data");
    assert.equal(preview.kind, 'person');
    assert.equal(preview.displayName, newName);
    assert.equal(preview.personId, undefined);
    assert.equal(await browser.evaluate("window.qualifiedName.calls.some(c=>c.args.action==='executeIdentity')"), false);

    await browser.evaluate(`(()=>{document.querySelector('.sheet-overlay').remove();window.openQualifiedPerson();
      const input=document.querySelector('.sheet-overlay input');input.value=${JSON.stringify(existingName)};
      document.querySelector('.sheet-overlay .btn-primary').click()})()`);
    await browser.wait("document.querySelector('.sheet-overlay .cand-wrap') !== null");
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary') === null"), true);
    await browser.healthy();
  } finally { await browser.close(); }
});

test('Quick Capture permits a reviewed new Person when only a different qualifier exists', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('zh-CN');
      window.qualifiedCapture={calls:[],async call(api,args){
        this.calls.push({api,args});
        if(api==='ai_parse'&&args.action==='quick_capture')return {parsed:{
          person_name:${JSON.stringify(newName)},interaction_type:'微信',
          interaction_date:'2026-10-22',facts:['【系统测试·勿联系】虚构事实']}};
        if(api==='person_360'&&args.action==='resolveQuickCaptureName')return {
          displayName:args.name,nameKey:${JSON.stringify(baseName)},status:'confirm_existing',
          hasMore:false,deletedIdentity:false,canCreateAfterConfirmation:true,
          candidates:[{id:'671',displayName:${JSON.stringify(existingName)}}]};
        if(api==='person_360'&&args.action==='previewIdentity')return {
          previewId:'9a51651a-3487-4cd6-8260-e31b96ee41d0',
          expiresAt:'2026-10-22T12:15:00+08:00',
          preview:{kind:args.data.kind,newPerson:true,displayName:args.data.displayName,
            interaction:args.data.interaction,facts:args.data.facts,signals:args.data.signals}};
        throw Error('Unexpected call: '+api+' '+args.action);
      }};
      openQuickCapture({api:{call:(api,args)=>window.qualifiedCapture.call(api,args)},toast:()=>{}},{});
    })()`);
    await browser.evaluate("(()=>{document.querySelector('.sheet-overlay textarea').value='【系统测试·勿联系】虚构交流';document.querySelector('.sheet-overlay .btn-primary').click()})()");
    await browser.wait("document.querySelector('.sheet-overlay .cand input') !== null");
    assert.equal(await browser.evaluate(`document.querySelector('.sheet-overlay').innerText.includes(${JSON.stringify(existingName)})`), true);
    await browser.evaluate(`(()=>{const input=document.querySelector('.sheet-overlay .cand input');
      input.value=${JSON.stringify(revisedName)};input.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()})()`);
    await browser.wait("window.qualifiedCapture.calls.some(c=>c.args.action==='previewIdentity')");
    const preview = await browser.evaluate("window.qualifiedCapture.calls.find(c=>c.args.action==='previewIdentity').args.data");
    assert.equal(preview.kind, 'capture_v2_new');
    assert.equal(preview.displayName, revisedName);
    assert.equal(preview.personId, undefined);
    assert.equal(await browser.evaluate("window.qualifiedCapture.calls.filter(c=>c.args.action==='resolveQuickCaptureName').length"), 2);
    assert.equal(await browser.evaluate("window.qualifiedCapture.calls.some(c=>c.args.action==='executeIdentity')"), false);
    await browser.healthy();
  } finally { await browser.close(); }
});
