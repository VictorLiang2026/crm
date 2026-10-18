'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Console existing Person capture previews the exact identity and executes one receipt', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('zh-CN');
      const name='【系统测试·勿联系】虚构体验甲';
      window.pc32d={calls:[],done:0,name,
        async call(api,args){this.calls.push({api,args});
          if(api==='ai_parse'&&args.action==='quick_capture')return {parsed:{
            person_name:name,interaction_type:'微信',interaction_date:'2026-10-18',
            facts:['【系统测试·勿联系】虚构事实'],
            opportunity:{has:true,type:'其他',note:'【系统测试·勿联系】虚构信号'}}};
          if(api==='person_360'&&args.action==='resolveQuickCaptureName')return {
            displayName:name,nameKey:name.toLowerCase(),status:'confirm_existing',hasMore:false,
            candidates:[{id:783,displayName:name,occupation:'',organization:''}]};
          if(api==='person_360'&&args.action==='previewIdentity')return {
            previewId:'217ecbb5-aa90-4d8b-92ec-6a3b82202901',expiresAt:'2026-10-18T12:15:00+08:00',
            preview:{kind:args.data.kind,newPerson:false,personId:783,displayName:name,
              interaction:args.data.interaction,facts:args.data.facts,signals:args.data.signals}};
          if(api==='person_360'&&args.action==='executeIdentity')return {personId:783,interactionId:900003,contextItemCount:2};
          throw Error('Unexpected call: '+api+' '+args.action);
        }};
      openQuickCapture({api:{call:(api,args)=>window.pc32d.call(api,args)},toast:()=>{}},
        {onDone:()=>window.pc32d.done++});
    })()`);
    await b.evaluate("(()=>{document.querySelector('.sheet-overlay textarea').value='【系统测试·勿联系】纯虚构原话';document.querySelector('.sheet-overlay .btn-primary').click()})()");
    await b.wait("document.querySelector('.sheet-overlay .cand') !== null");
    await b.evaluate("document.querySelector('.sheet-overlay .cand').click()");
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.pc32d.calls.some(c=>c.args.action==='previewIdentity')");
    const preview = await b.evaluate("window.pc32d.calls.find(c=>c.args.action==='previewIdentity').args.data");
    assert.equal(preview.kind, 'capture_v2_existing');
    assert.equal(preview.personId, '783');
    assert.equal(preview.displayName, '【系统测试·勿联系】虚构体验甲');
    assert.equal(preview.facts.length, 1);
    assert.equal(preview.signals.length, 1);
    assert.equal(await b.evaluate("window.pc32d.calls.some(c=>c.args.action==='executeIdentity')"), false);
    assert.equal(await b.evaluate("document.querySelector('.sheet-overlay').innerText.includes('重复提交返回原记录')"), true);
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait('window.pc32d.done===1');
    assert.equal(await b.evaluate("window.pc32d.calls.filter(c=>c.args.action==='executeIdentity').length"), 1);
    assert.equal(await b.evaluate("window.pc32d.calls.some(c=>c.args.action==='commitQuickCaptureV2')"), false);
    await b.evaluate(`(async()=>{
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
      setLang('en');
      openQuickCapture({api:{call:(api,args)=>window.pc32d.call(api,args)},toast:()=>{}},{});
      document.querySelector('.sheet-overlay textarea').value='【系统测试·勿联系】fictional note';
      document.querySelector('.sheet-overlay .btn-primary').click();
    })()`);
    await b.wait("document.querySelector('.sheet-overlay .cand') !== null");
    await b.evaluate("(()=>{document.querySelector('.sheet-overlay .cand').click();[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()})()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('original record')");
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await b.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    }
    await b.send('Emulation.clearDeviceMetricsOverride');
    await b.healthy();
  } finally { await b.close(); }
});
