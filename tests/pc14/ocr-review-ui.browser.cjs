'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person OCR review requires identity and field review before apply, and version-checks undo on iPad', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderOcrReview}=await import('/crm/js/modules/console/ocr-review.js');
      const i18n=await import('/crm/js/modules/console/i18n.js'); window.pc14I18n=i18n;
      window.pc14={calls:[],executions:[],profile:{status:'linked',customerId:'788',person:{display_name:'虚构客户甲'},fields:{
        customer_name:'虚构客户甲',phone:'',gender:'未知',birthday:null,occupation:'',education:'',marital_status:'未婚',
        customer_stage:'新认识',sales_priority:'C',referral_priority:'C',hobbies:'',source:'人工新增',additional_info:''}},
        records:[{id:95,customer_id:788,summary:'虚构资料识别摘要',raw_text:'姓名：虚构客户甲；电话：13800000000',file_ids:'[96]',file_names:'["虚构文件.png"]',created_at:'2026-10-15T08:00:00Z'}],
        commands:[{id:'11111111-1111-4111-8111-111111111111',ocr_record_id:95,operation:'apply',status:'executed',created_at:'2026-10-15T08:01:00Z',executed_at:'2026-10-15T08:02:00Z'}],
        async call(name,args){this.calls.push({name,args});
          if(name==='person_360'&&args.action==='getCustomerProfile')return this.profile;
          if(name==='ocr_records'&&args.action==='list')return {rows:this.records};
          if(name==='person_360'&&args.action==='listOcrParseCommands')return this.commands;
          if(name==='ai_parse'&&args.action==='parse')return {parsed:{customer_name:'虚构客户甲',phone:'13800000000',gender:'女'}};
          if(name==='person_360'&&args.action==='resolveIdentity')return {candidates:[{id:71,displayName:'虚构客户甲',legacyCustomerId:788}]};
          if(name==='person_360'&&args.action==='previewOcrParse')return {previewId:'22222222-2222-4222-8222-222222222222',expiresAt:'2026-10-16T09:00:00Z',preview:{before:{phone:null,gender:'未知'},after:{phone:'13800000000',gender:'女'}}};
          if(name==='person_360'&&args.action==='previewOcrUndo'){
            if(this.forceUndoConflict)throw Error('OCR undo conflict: profile version changed after parsing');
            return {previewId:'33333333-3333-4333-8333-333333333333',expiresAt:'2026-10-16T09:00:00Z',preview:{before:{phone:'13800000000'},after:{phone:null}}};
          }
          if(name==='person_360'&&args.action==='executeOcrParse'){this.executions.push(args);return {ok:true,commandId:'44444444-4444-4444-8444-444444444444'};}
          if(name==='photos')return {photo:{id:96,customer_id:788,file_name:'虚构文件.png',content_type:'image/png',photo_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h7sAAAAASUVORK5CYII='}};
          throw Error('Unexpected call '+name+' '+JSON.stringify(args));
        }};
      const ctx={api:{call:(name,args)=>window.pc14.call(name,args)},onWriteDone:()=>{window.pc14.reloads=(window.pc14.reloads||0)+1}};
      const host=document.getElementById('pc14-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc14-host'}));
      window.renderPc14=async()=>host.replaceChildren(await renderOcrReview(ctx,'71'));
      await window.renderPc14();
    })()`);
    await b.wait("document.querySelector('#pc14-host .ocr-record')");
    await b.evaluate("document.querySelector('#pc14-host .ocr-record').open=true");
    await b.click('#pc14-host .ocr-source-actions button', '查看原文件');
    await b.wait("document.querySelector('#pc14-host .ocr-source-viewer img')");
    assert.equal(await b.evaluate("document.querySelector('#pc14-host .ocr-source-viewer img').alt"), '虚构文件.png');
    await b.click('#pc14-host .ocr-record-actions button', '解析资料字段');
    await b.wait("document.querySelector('#pc14-host .ocr-candidate-panel')");
    await b.click('#pc14-host .ocr-identity-block button', '查找匹配人物');
    await b.wait("document.querySelector('#pc14-host .ocr-candidate-person')");
    await b.evaluate("document.querySelector('#pc14-host .ocr-candidate-person input').click()");
    await b.evaluate("document.querySelector('#pc14-host .ocr-identity-block input[type=checkbox]').click()");
    await b.evaluate("document.querySelector('#pc14-host .ocr-field-row input[type=checkbox]').click()");
    const beforePreview = await b.evaluate(`(()=>({disabled:document.querySelector('#pc14-host .ocr-candidate-panel > button').disabled,
      executions:window.pc14.executions.length,selected:document.querySelector('#pc14-host .ocr-field-row textarea').value}))()`);
    assert.equal(beforePreview.executions, 0);
    assert.equal(beforePreview.selected, '13800000000');
    await b.click('#pc14-host .ocr-candidate-panel button', '生成服务端预览');
    await b.wait("document.querySelector('#pc14-host .ocr-preview-panel')?.innerText.includes('13800000000')");
    assert.equal(await b.evaluate('window.pc14.executions.length'), 0, 'preview is read-only');
    await b.evaluate(`(()=>{const input=document.querySelector('#pc14-host .ocr-field-row textarea');input.value='13800000001';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    assert.equal(await b.evaluate("!!document.querySelector('#pc14-host .ocr-preview-panel')"), false, 'field edits invalidate the earlier preview');
    await b.evaluate(`(()=>{const input=document.querySelector('#pc14-host .ocr-field-row textarea');input.value='13800000000';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await b.click('#pc14-host .ocr-candidate-panel button', '生成服务端预览');
    await b.wait("document.querySelector('#pc14-host .ocr-preview-panel')?.innerText.includes('13800000000')");
    await b.evaluate("document.querySelector('#pc14-host .ocr-preview-panel input[type=checkbox]').click()");
    await b.click('#pc14-host .ocr-preview-panel button', '确认写入');
    await b.wait('window.pc14.executions.length===1');
    const applyCall = await b.evaluate("window.pc14.calls.find(c=>c.args.action==='previewOcrParse')");
    assert.deepEqual(applyCall.args.data.selectedFields, ['phone']);
    assert.equal(applyCall.args.data.personId, '71');

    await b.click('#pc14-host .ocr-history-row button', '审阅撤销');
    await b.click('#pc14-host .ocr-preview-panel button', '核对撤销预览');
    await b.wait("document.querySelector('#pc14-host .ocr-preview-panel .ocr-diff-row')");
    assert.equal(await b.evaluate('window.pc14.executions.length'), 1, 'undo preview is read-only');
    await b.evaluate("document.querySelector('#pc14-host .ocr-preview-panel input[type=checkbox]').click()");
    await b.click('#pc14-host .ocr-preview-panel button', '确认撤销');
    await b.wait('window.pc14.executions.length===2');
    assert.equal(await b.evaluate("window.pc14.calls.find(c=>c.args.action==='previewOcrUndo').args.data.confirmed"), true);
    await b.evaluate("window.pc14.forceUndoConflict=true");
    await b.click('#pc14-host .ocr-history-row button', '审阅撤销');
    await b.click('#pc14-host .ocr-preview-panel button', '核对撤销预览');
    await b.wait("document.querySelector('#pc14-host .ocr-preview-panel .ocr-message-error')");
    assert.ok((await b.evaluate("document.querySelector('#pc14-host .ocr-preview-panel').innerText")).includes('profile version changed'));

    await b.evaluate(`(()=>{window.pc14I18n.setLang('en');return window.renderPc14()})()`);
    await b.wait("document.querySelector('#pc14-host').innerText.includes('OCR & Document Review')");
    for(const [width,height] of [[820,1180],[1180,820]]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const metrics=await b.evaluate(`(()=>({width:innerWidth,doc:document.documentElement.scrollWidth,host:document.querySelector('#pc14-host').scrollWidth,client:document.querySelector('#pc14-host').clientWidth}))()`);
      assert.ok(metrics.doc<=width+1,`document overflow ${JSON.stringify(metrics)}`);
      assert.ok(metrics.host<=metrics.client+1,`OCR panel overflow ${JSON.stringify(metrics)}`);
    }
    await b.healthy();
  } finally { await b.close(); }
});
