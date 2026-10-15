'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person care materials keeps customer-only contract, lazy file reads, bilingual copy, and iPad layouts', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {careMaterialsNode}=await import('/crm/js/modules/console/care-materials.js');
      window.careMaterialsNode=careMaterialsNode;
      const i18n=await import('/crm/js/modules/console/i18n.js');window.pc11I18n=i18n;
      window.pc11Calls=[];
      window.pc11Ctx={toast:(message,type)=>window.pc11Calls.push({toast:message,type}),api:{call:async(name,args)=>{
        window.pc11Calls.push({name,args});
        if(name==='person_360'&&args.action==='getCustomerProfile')return{status:'linked',personId:'783',customerId:788};
        if(name==='gifts'&&args.action==='list')return{rows:[{Id:1001,customer_id:788,gift_name:'[CRM_TEST_ONLY]节日礼品',quantity:1,given_date:'2026-10-10',notes:'[CRM_TEST_ONLY]说明'}],hasMore:false};
        if(name==='photos'&&args.action==='list')return{rows:[{id:25,customer_id:788,category:'photo',file_name:'[CRM_TEST_ONLY]photo.jpg',content_type:'image/jpeg',sort_order:0,created_at:'2026-10-04',photo_notes:'[CRM_TEST_ONLY]附件'}],hasMore:false};
        if(name==='gifts'&&args.action==='create')return{id:1002};
        if(name==='gifts'&&args.action==='update')return{ok:true};
        if(name==='gifts'&&args.action==='remove')return{ok:true};
        if(name==='photos'&&args.action==='get')return{photo:{id:25,customer_id:788,category:'photo',content_type:'image/jpeg',file_name:'[CRM_TEST_ONLY]photo.jpg',photo_url:'data:image/jpeg;base64,QQ=='}};
        if(name==='photos'&&args.action==='create'){if(window.pc11FailUpload){window.pc11FailUpload=false;return{error:'simulated upload failure'}}return{id:1003};}
        if(name==='photos'&&args.action==='update')return{ok:true};
        if(name==='photos'&&args.action==='remove')return{ok:true};
        throw Error('unexpected '+name+'.'+args.action);
      }}};
      document.getElementById('view').replaceChildren(await careMaterialsNode(window.pc11Ctx,'783'));
      window.pc11OnlyCtx={api:{call:async(name,args)=>{
        window.pc11Calls.push({name,args});
        if(name==='person_360'&&args.action==='getCustomerProfile')return{status:'person_only',customerId:null};
        throw Error('person-only must not access customer data');
      }}};
    })()`);
    await browser.wait("document.querySelector('.care-materials')?.innerText.includes('节日礼品')");
    await browser.wait("document.querySelector('.care-file-record')?.innerText.includes('photo.jpg')");
    const loadingCalls = await browser.evaluate("window.pc11Calls.filter(c=>c.name==='photos').map(c=>c.args.action)");
    assert.deepEqual(loadingCalls, ['list']);
    const metaRequest = await browser.evaluate("window.pc11Calls.find(c=>c.name==='photos'&&c.args.action==='list').args");
    assert.equal(metaRequest.customer_id, 788);
    assert.equal(metaRequest.limit, 30);
    assert.equal(metaRequest.offset, 0);

    await browser.evaluate("document.querySelector('.care-file-record .care-record-actions .btn-soft').click()");
    await browser.wait("window.pc11Calls.some(c=>c.name==='photos'&&c.args.action==='get')");
    const getRequest = await browser.evaluate("window.pc11Calls.find(c=>c.name==='photos'&&c.args.action==='get').args");
    assert.deepEqual({id:getRequest.id,customer_id:getRequest.customer_id},{id:25,customer_id:788});
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-head button').click()");
    await browser.wait("!document.querySelector('.sheet-overlay')");

    const addGiftButton = await browser.evaluate("(()=>{const b=document.querySelector('.care-materials-section:first-child .care-section-head button.btn-primary');return b?{text:b.textContent,tag:b.tagName}:null})()");
    assert.deepEqual(addGiftButton,{text:'新增礼品',tag:'BUTTON'});
    await browser.evaluate("document.querySelector('.care-materials-section:first-child .care-section-head button.btn-primary').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))");
    await browser.wait("document.querySelector('.sheet-overlay')?.innerText.includes('礼品名称')");
    await browser.evaluate(`(()=>{
      const input=(name)=>document.querySelector('.sheet-overlay [name="'+name+'"]');
      input('gift_name').value='[CRM_TEST_ONLY]新礼品';input('quantity').value='2';input('given_date').value='2026-10-15';input('notes').value='[CRM_TEST_ONLY]测试说明';
      const save=[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].find(b=>b.textContent.trim()==='保存');save.click();save.click();
    })()`);
    await browser.wait("window.pc11Calls.some(c=>c.name==='gifts'&&c.args.action==='create')");
    const giftCreate = await browser.evaluate("window.pc11Calls.find(c=>c.name==='gifts'&&c.args.action==='create').args");
    assert.equal(giftCreate.data.customer_id,788);
    assert.equal(giftCreate.data.quantity,2);
    assert.equal(Object.hasOwn(giftCreate.data,'category'),false);

    await browser.evaluate(`(()=>{
      const input=document.querySelector('.care-file-input');
      const file=new File(['[CRM_TEST_ONLY]'], '[CRM_TEST_ONLY]note.txt', {type:'text/plain'});
      Object.defineProperty(input,'files',{configurable:true,value:[file]});
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("window.pc11Calls.some(c=>c.name==='photos'&&c.args.action==='create')");
    const photoCreate = await browser.evaluate("window.pc11Calls.find(c=>c.name==='photos'&&c.args.action==='create').args");
    assert.equal(photoCreate.data.customer_id,788);
    assert.equal(photoCreate.data.content_type,'text/plain');
    assert.equal(photoCreate.data.category,'attachment');
    assert.equal(Object.hasOwn(photoCreate.data,'activity_id'),false);
    assert.equal(await browser.evaluate("window.pc11Calls.filter(c=>c.name==='gifts'&&c.args.action==='create').length"),1);
    assert.equal(await browser.evaluate("window.pc11Calls.filter(c=>c.name==='photos'&&c.args.action==='create').length"),1);

    await browser.evaluate(`(()=>{const input=document.querySelector('.care-file-input');const file=new File([new Uint8Array(4*1024*1024+1)],'[CRM_TEST_ONLY]too-large.bin',{type:'application/octet-stream'});Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await browser.wait("document.querySelectorAll('.care-materials-section:nth-child(2) .care-status')[1]?.innerText.includes('未上传')");
    assert.equal(await browser.evaluate("window.pc11Calls.filter(c=>c.name==='photos'&&c.args.action==='create').length"),1);

    await browser.evaluate(`(()=>{window.pc11FailUpload=true;const input=document.querySelector('.care-file-input');const file=new File(['[CRM_TEST_ONLY]'], '[CRM_TEST_ONLY]failed.txt', {type:'text/plain'});Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await browser.wait("document.querySelectorAll('.care-materials-section:nth-child(2) .care-status')[1]?.innerText.includes('failed.txt')");

    const en = await browser.evaluate(`(()=>{window.pc11I18n.setLang('en');const value={tab:window.pc11I18n.t('tab_care_materials'),gift:window.pc11I18n.t('care_add_gift'),delete:window.pc11I18n.t('care_delete_photo_confirm')};window.pc11I18n.setLang('zh-CN');return value})()`);
    assert.equal(en.tab,'Care & Materials');
    assert.equal(en.gift,'Add Gift');
    assert.match(en.delete,/permanent/);

    const beforePersonOnly = await browser.evaluate("window.pc11Calls.filter(c=>c.name==='gifts'||c.name==='photos').length");
    await browser.evaluate("document.getElementById('view').replaceChildren('')");
    await browser.evaluate(`(async()=>document.getElementById('view').replaceChildren(await careMaterialsNode(window.pc11OnlyCtx,'785')))()`);
    await browser.wait("document.querySelector('.care-materials')?.innerText.includes('需要有效的客户关联')");
    assert.equal(await browser.evaluate("window.pc11Calls.filter(c=>c.name==='gifts'||c.name==='photos').length"), beforePersonOnly);

    await browser.evaluate(`(async()=>document.getElementById('view').replaceChildren(await careMaterialsNode(window.pc11Ctx,'783')))()`);
    await browser.wait("document.querySelector('.care-materials')");
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    await browser.healthy();
    assert.deepEqual(browser.networkViolations,[]);
  } finally { await browser.close(); }
});
