'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person insurance editor renders five fields in one iPad row, saves policy notes and fits both orientations', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/today');
    for (const [width, height] of [[1024, 768], [768, 1024]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      await b.evaluate(`(async()=>{
        const {renderInsuranceEditor}=await import('/crm/js/modules/console/insurance-editor.js');
        window.pc12Calls=[]; window.pc12Reloads=0;
        const ctx={api:{call:async(name,args)=>{
          window.pc12Calls.push({name,args});
          if(name==='products'&&args.action==='list')return {customerId:'788',version:'0',rows:[]};
          if(name==='products'&&args.action==='upsert')return {id:'2',version:'1'};
          throw Error('unexpected '+name+'/'+args.action);
        }},onWriteDone:()=>{window.pc12Reloads++;}};
        const host=document.getElementById('pc12-insurance-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc12-insurance-host'}));
        host.replaceChildren(renderInsuranceEditor(ctx,'783'));
      })()`);
      await b.wait("document.querySelectorAll('#pc12-insurance-host .insurance-category').length===11");
      const dimensions = await b.evaluate(`(()=>{const e=document.querySelector('#pc12-insurance-host .insurance-editor');return {width:innerWidth,scroll:e.scrollWidth,client:e.clientWidth,inputs:e.querySelectorAll('input').length}})()`);
      assert.equal(dimensions.width, width);
      assert.equal(dimensions.inputs, 0, 'inputs are hidden until the user enters edit mode');
      assert.ok(dimensions.scroll <= dimensions.client, `horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      await b.click('#pc12-insurance-host button', '新增保障明细');
      const editCount = await b.evaluate("document.querySelectorAll('#pc12-insurance-host input').length");
      assert.equal(editCount, 55);
      await b.evaluate("document.querySelector('#pc12-insurance-host .insurance-category').open=true");
      const rowLayout = await b.evaluate(`(()=>{const g=document.querySelector('#pc12-insurance-host .insurance-fields-grid');const inputs=[...g.querySelectorAll('input')];return {width:g.clientWidth,tops:inputs.map(x=>x.getBoundingClientRect().top)}})()`);
      assert.equal(new Set(rowLayout.tops).size, 1, `all five fields align on one row on iPad: ${JSON.stringify(rowLayout)}`);
      assert.equal(await b.evaluate("document.querySelectorAll('#pc12-insurance-host textarea').length"), 1);
      await b.evaluate(`(()=>{
        const inputs=[...document.querySelectorAll('#pc12-insurance-host input')];
        inputs[0].value='9223372036854775807.99';
        inputs[1].value='9007199254740993';
        inputs[2].value='0';
        inputs[5].value='0';
        document.querySelector('#pc12-insurance-host textarea').value='本年度已核对保单，待补充缴费凭证';
        [...document.querySelectorAll('#pc12-insurance-host button')].find(x=>x.textContent.includes('保存保障资料')).click();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      const postClick = await b.evaluate("({calls:window.pc12Calls,visible:document.querySelector('#pc12-insurance-host').innerText,errors:window.__crmTest.errors})");
      assert.ok(postClick.calls.some(x=>x.args.action==='upsert'), JSON.stringify(postClick));
      const saved = await b.evaluate("window.pc12Calls.find(x=>x.args.action==='upsert').args");
      const details = JSON.parse(saved.data.items);
      assert.equal(saved.personId, '783');
      assert.equal(saved.expectedVersion, '0');
      assert.equal(saved.data.ap_ipa, '9223372036854775807.99');
      assert.equal(details.find(x=>x.key==='ap_ipa').total_premium, '9007199254740993');
      assert.equal(details.find(x=>x.key==='ap_ipa').paid_premium, '0');
      assert.equal(saved.data.current_policy_description, '本年度已核对保单，待补充缴费凭证');
      assert.equal(saved.data.ap_ppa, '0');
      assert.equal(saved.data.ap_ltc, null);
      await b.wait('window.pc12Reloads===1');
      assert.equal(await b.evaluate('window.pc12Reloads'), 1);
    }
    await b.healthy();
  } finally { await b.close(); }
});

test('Person insurance editor offers a reload after an optimistic-lock conflict', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderInsuranceEditor}=await import('/crm/js/modules/console/insurance-editor.js');
      window.pc12Reloads=0;
      const ctx={api:{call:async(name,args)=>args.action==='list'?{customerId:'788',version:'1',rows:[{version:1,items:null}]}:
        (()=>{throw Error('VERSION_CONFLICT: stale');})()},onWriteDone:()=>{window.pc12Reloads++;}};
      const host=document.getElementById('pc12-conflict-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc12-conflict-host'}));
      host.replaceChildren(renderInsuranceEditor(ctx,'783'));
    })()`);
    await b.wait("document.querySelector('#pc12-conflict-host button')?.textContent.includes('编辑保障明细')");
    await b.click('#pc12-conflict-host button', '编辑保障明细');
    await b.click('#pc12-conflict-host button', '保存保障资料');
    await new Promise(resolve => setTimeout(resolve, 150));
    const conflictState=await b.evaluate("({text:document.querySelector('#pc12-conflict-host').innerText,calls:window.__crmTest.errors})");
    assert.ok(conflictState.text.includes('资料已被其他操作更新'), JSON.stringify(conflictState));
    await b.click('#pc12-conflict-host button', '重新载入');
    assert.equal(await b.evaluate('window.pc12Reloads'), 1);
    await b.healthy();
  } finally { await b.close(); }
});

test('Person insurance editor blocks editing until the customer relationship exists', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderInsuranceEditor}=await import('/crm/js/modules/console/insurance-editor.js');
      const ctx={api:{call:async(name,args)=>({rows:[],customerId:null,version:null})}};
      const host=document.getElementById('pc12-unlinked-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc12-unlinked-host'}));
      host.replaceChildren(renderInsuranceEditor(ctx,'785'));
    })()`);
    await b.wait("document.querySelector('#pc12-unlinked-host').innerText.includes('尚未关联客户档案')");
    assert.equal(await b.evaluate("document.querySelectorAll('#pc12-unlinked-host button').length"), 0);
    await b.healthy();
  } finally { await b.close(); }
});
