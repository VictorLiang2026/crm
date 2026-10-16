'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person insurance reports preserve AI originals, show human revisions, and update only edited fields', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderInsuranceReports}=await import('/crm/js/modules/console/insurance-reports.js');
      window.pc13State={calls:[],reloads:0,report:{
        id:31,customer_id:788,report_date:'2026-10-12',report_type:'保单年度检视',
        created_at:'2026-10-12T03:20:00.000Z',input_products_version:4,
        summary:'AI 摘要原文',edited_summary:'人工修订摘要',gaps_found:'AI 缺口原文',edited_gaps:'待核实：请先核对保障资料',
        recommendations:'AI 建议原文',edited_recommendations:null,asset_allocation:'AI 资产原文',edited_asset_allocation:null,
        next_action:'AI 下一步原文',edited_next_action:null,raw:'原始模型输出 JSON'
      }};
      const ctx={api:{call:async(name,args)=>{
        window.pc13State.calls.push({name,args});
        if(name!=='policy_review_reports')throw Error('unexpected function '+name);
        if(args.action==='list')return {rows:[window.pc13State.report]};
        if(args.action==='get')return {report:window.pc13State.report};
        if(args.action==='update'){
          window.pc13State.report={...window.pc13State.report,...args.data};
          return {ok:true};
        }
        throw Error('unexpected action '+args.action);
      }},onWriteDone:()=>{window.pc13State.reloads++}};
      const host=document.getElementById('pc13-history-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc13-history-host'}));
      host.replaceChildren(renderInsuranceReports(ctx,'788'));
    })()`);
    await b.wait("document.querySelector('#pc13-history-host .policy-report-item')");
    await b.evaluate("document.querySelector('#pc13-history-host .policy-report-item').open=true");
    await b.wait("document.querySelector('#pc13-history-host .policy-report-body .policy-report-field')");
    const before = await b.evaluate(`(()=>{
      const root=document.querySelector('#pc13-history-host');
      return {text:root.innerText,raw:root.textContent,calls:window.pc13State.calls};
    })()`);
    assert.ok(before.text.includes('人工修订摘要'), JSON.stringify(before));
    assert.ok(before.text.includes('待核实：请先核对保障资料'), JSON.stringify(before));
    assert.ok(before.text.includes('产品资料版本 4'), JSON.stringify(before));
    assert.ok(before.raw.includes('AI 摘要原文'), 'AI original remains in the record');
    assert.ok(before.raw.includes('原始模型输出 JSON'), 'raw model output remains available');
    await b.click('#pc13-history-host button', '修订报告');
    await b.evaluate(`(()=>{
      const fields=[...document.querySelectorAll('#pc13-history-host textarea')];
      fields[0].value='人工再次修订';
      fields[1].value='再次待核实';
    })()`);
    await b.click('#pc13-history-host button', '保存修订');
    await b.wait("window.pc13State.calls.some(c=>c.args.action==='update') && window.pc13State.reloads===1");
    const after = await b.evaluate(`(()=>{
      const call=window.pc13State.calls.find(c=>c.args.action==='update');
      return {payload:call.args.data,source:window.pc13State.report};
    })()`);
    assert.deepEqual(Object.keys(after.payload).sort(), [
      'edited_asset_allocation','edited_gaps','edited_next_action','edited_recommendations','edited_summary',
    ].sort());
    assert.equal(after.payload.edited_summary, '人工再次修订');
    assert.equal(after.payload.edited_gaps, '再次待核实');
    assert.equal(after.source.summary, 'AI 摘要原文');
    assert.equal(after.source.raw, '原始模型输出 JSON');
    await b.healthy();
  } finally { await b.close(); }
});

test('Person insurance report generation uses the linked customer and keeps the result review-only on iPad', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderInsuranceReports}=await import('/crm/js/modules/console/insurance-reports.js');
      window.pc13State={calls:[],generated:false,report:{id:32,report_date:'2026-10-16',report_type:'保单年度检视',
        created_at:'2026-10-16T01:00:00.000Z',input_products_version:null,summary:'新报告摘要',raw:'原始生成记录'}};
      const ctx={api:{call:async(name,args)=>{
        window.pc13State.calls.push({name,args});
        if(args.action==='list')return {rows:window.pc13State.generated?[window.pc13State.report]:[]};
        if(args.action==='generate'){window.pc13State.generated=true;return {id:'32',report:window.pc13State.report};}
        if(args.action==='get')return {report:window.pc13State.report};
        throw Error('unexpected action '+args.action);
      }}};
      const host=document.getElementById('pc13-generate-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc13-generate-host'}));
      host.replaceChildren(renderInsuranceReports(ctx,'788'));
    })()`);
    await b.wait("document.querySelector('#pc13-generate-host').innerText.includes('暂无检视报告')");
    for (const [width,height] of [[1024,768],[768,1024]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
      const metrics=await b.evaluate(`(()=>{const e=document.querySelector('#pc13-generate-host .policy-reports');return {width:innerWidth,scroll:e.scrollWidth,client:e.clientWidth}})()`);
      assert.equal(metrics.width,width);
      assert.ok(metrics.scroll<=metrics.client,`horizontal overflow ${JSON.stringify(metrics)}`);
    }
    await b.click('#pc13-generate-host button','生成检视报告');
    await b.wait("window.pc13State.generated && document.querySelector('#pc13-generate-host .policy-report-item')");
    await b.evaluate("document.querySelector('#pc13-generate-host .policy-report-item').open=true");
    await b.wait("document.querySelector('#pc13-generate-host .policy-report-body .policy-report-field')");
    const after=await b.evaluate(`({calls:window.pc13State.calls,text:document.querySelector('#pc13-generate-host').innerText})`);
    assert.ok(after.calls.some(c=>c.args.action==='generate'&&c.args.customer_id===788),JSON.stringify(after));
    assert.ok(after.text.includes('报告生成可能需要一到两分钟') || after.text.includes('AI 报告仅供审阅'),JSON.stringify(after));
    assert.ok(after.text.includes('未记录'),JSON.stringify(after));
    await b.healthy();
  } finally { await b.close(); }
});

test('Person insurance reports do not call the report service without an active customer link', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderInsuranceReports}=await import('/crm/js/modules/console/insurance-reports.js');
      window.pc13Calls=[];
      const ctx={api:{call:async(name,args)=>{window.pc13Calls.push({name,args});throw Error('must not call');}}};
      const host=document.getElementById('pc13-unlinked-host')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'pc13-unlinked-host'}));
      host.replaceChildren(renderInsuranceReports(ctx,null));
    })()`);
    const state=await b.evaluate(`(()=>({text:document.querySelector('#pc13-unlinked-host').innerText,
      disabled:[...document.querySelectorAll('#pc13-unlinked-host button')].every(b=>b.disabled),calls:window.pc13Calls}))()`);
    assert.ok(state.text.includes('尚未关联客户档案'),JSON.stringify(state));
    assert.ok(state.disabled,JSON.stringify(state));
    assert.deepEqual(state.calls,[]);
    await b.healthy();
  } finally { await b.close(); }
});
