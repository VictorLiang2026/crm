'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Console new Person capture shows server preview and executes once without the old second write', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('zh-CN');
      const name='【系统测试·勿联系】PC32-C 虚构人物';
      window.pc32c={calls:[],name,done:0,
        async call(api,args){this.calls.push({api,args});
          if(api==='ai_parse'&&args.action==='quick_capture')return {parsed:{
            person_name:name,interaction_type:'微信',interaction_date:'2026-10-18',
            facts:['【系统测试·勿联系】虚构事实'],
            opportunity:{has:true,type:'其他',note:'【系统测试·勿联系】虚构信号'}}};
          if(api==='person_360'&&args.action==='resolveQuickCaptureName')return {
            displayName:name,nameKey:name.toLowerCase(),status:'available',hasMore:false,candidates:[]};
          if(api==='person_360'&&args.action==='previewIdentity')return {
            previewId:'9a51651a-3487-4cd6-8260-e31b96ee41d0',expiresAt:'2026-10-18T12:15:00+08:00',
            preview:{kind:args.data.kind,newPerson:true,displayName:name,
              interaction:args.data.interaction,facts:args.data.facts,signals:args.data.signals}};
          if(api==='person_360'&&args.action==='executeIdentity')return {personId:900001,interactionId:900002,contextItemCount:2};
          throw Error('Unexpected call: '+api+' '+args.action);
        }};
      openQuickCapture({api:{call:(api,args)=>window.pc32c.call(api,args)},
        toast:()=>{},onWriteDone:()=>{},}, {onDone:()=>window.pc32c.done++});
    })()`);
    await b.evaluate(`(()=>{document.querySelector('.sheet-overlay textarea').value='【系统测试·勿联系】纯虚构原话';document.querySelector('.sheet-overlay .btn-primary').click()})()`);
    await b.wait("document.querySelector('.sheet-overlay .cand input') !== null");
    await b.evaluate("(()=>{const input=document.querySelector('.sheet-overlay .cand input');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.pc32c.calls.some(c=>c.args.action==='previewIdentity')");
    assert.equal(await b.evaluate("window.pc32c.calls.some(c=>c.args.action==='executeIdentity')"), false);
    const preview = await b.evaluate("window.pc32c.calls.find(c=>c.args.action==='previewIdentity').args.data");
    assert.equal(preview.kind, 'capture_v2_new');
    assert.deepEqual(preview.facts, ['【系统测试·勿联系】虚构事实']);
    assert.equal(preview.signals.length, 1);
    assert.ok(preview.signals[0].includes('【系统测试·勿联系】虚构信号'));
    assert.ok(preview.interaction.rawNote.includes('纯虚构原话'));
    assert.equal(await b.evaluate("document.querySelector('.sheet-overlay').innerText.includes('同一事务')"), true);
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait('window.pc32c.done===1');
    assert.equal(await b.evaluate("window.pc32c.calls.filter(c=>c.args.action==='executeIdentity').length"), 1);
    assert.equal(await b.evaluate("window.pc32c.calls.some(c=>c.args.action==='commitQuickCaptureV2')"), false);
    await b.evaluate(`(async()=>{
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
      setLang('en');
      openQuickCapture({api:{call:(api,args)=>window.pc32c.call(api,args)},toast:()=>{}},{});
      document.querySelector('.sheet-overlay textarea').value='【系统测试·勿联系】fictional note';
      document.querySelector('.sheet-overlay .btn-primary').click();
    })()`);
    await b.wait("document.querySelector('.sheet-overlay .cand input') !== null");
    await b.evaluate("(()=>{const input=document.querySelector('.sheet-overlay .cand input');input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()})()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('one transaction')");
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await b.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    }
    await b.send('Emulation.clearDeviceMetricsOverride');
    await b.healthy();
  } finally { await b.close(); }
});
