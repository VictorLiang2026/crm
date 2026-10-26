'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
const ROOT=path.resolve(__dirname,'../..');
async function setup(b,lang='zh-CN',kind='customer') {
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
    const m=await import('/crm/js/modules/console/pages/recycle.js');
    const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang(${JSON.stringify(lang)});
    sessionStorage.removeItem('crm_recycle_receipt_customer');sessionStorage.removeItem('crm_recycle_receipt_recruit');
    window.l07={calls:[],commands:{},fail:true,network:false,unexecuted:false,delay:null};
    window.l07ctx={main:document.querySelector('#console-main'),toast(){},api:{call:async(name,args)=>{
      const state=window.l07;state.calls.push({name,...args});
      if(args.action==='trashList'){
        if(state.delay&&args.keyword==='slow'){await new Promise(r=>state.resolve=r);}
        return {rows:Array.from({length:args.page===2?1:20},(_,i)=>({Id:1000+(args.page-1)*20+i,candidate_id:1000+(args.page-1)*20+i,
          customer_id:2000+i,customer_name:'[CRM_TEST_ONLY] Fictional '+i,deleted_at:'2026-10-20T00:00:00Z',candidate_deleted_at:'2026-10-20T00:00:00Z',legacy_delete:false})),total:21};
      }
      if(args.action==='listPersonOnlyRecruitTrash')return {rows:[{candidate_id:2001,customer_id:null,customer_name:'[CRM_TEST_ONLY] Person Only',candidate_deleted_at:'2026-10-21T00:00:00Z'}]};
      if(args.action==='previewRecycleBatch'){
        const id=crypto.randomUUID();const value={previewId:id,status:'preview',expiresAt:new Date(Date.now()+900000).toISOString(),
          items:args.data.items.map(item=>({...item,name:'[CRM_TEST_ONLY] Verified '+item.id,code:'READY',batchId:'12345678-1234-4234-8234-123456789abc',counts:{followups:2},linkedCount:2}))};
        state.commands[id]=value;return value;
      }
      if(args.action==='executeRecycleBatch'){
        const value=state.commands[args.previewId];
        if(!state.unexecuted){value.status='executed';value.results=value.items.map((item,i)=>({...item,code:state.fail&&i===1?'STALE_SCOPE':'RESTORED'}));}
        if(state.network)throw Error('Lost response');return value;
      }
      if(args.action==='getRecycleBatch')return state.commands[args.previewId];
      if(args.action==='restore'||args.action==='restorePersonOnlyRecruit')return {ok:true};
      throw Error('Unexpected '+name+':'+args.action);
    }}};
    window.l07render=${kind==='customer'?'m.renderCustomerTrash':'m.renderRecruitTrash'};window.l07render(window.l07ctx);
  })()`);
  await b.wait("document.querySelectorAll('#console-main tbody input[type=checkbox]').length===20");
}
const click=b=>b.evaluate("document.querySelector('[data-batch-preview]').click()");
test('L07 current-page selection, verified confirmation, partial receipts and failed-only retry on bilingual iPad',async()=>{
  const b=new Browser(ROOT);
  try{
    await b.start();
    for(const lang of ['zh-CN','en']){
      await setup(b,lang);
      await b.evaluate("document.querySelector('.recycle-batch-toolbar input').click()");
      assert.equal(await b.evaluate("document.querySelectorAll('tbody input:checked').length"),20);
      await b.evaluate("document.querySelector('.pager button:last-child').click()");
      await b.wait("document.querySelectorAll('tbody tr').length===1");
      assert.equal(await b.evaluate("document.querySelector('[data-batch-preview]').disabled"),true);
      await b.evaluate("document.querySelector('.pager button:first-child').click()");
      await b.wait("document.querySelectorAll('tbody tr').length===20");
      await b.evaluate("[...document.querySelectorAll('tbody input')].slice(0,3).forEach(x=>x.click())");await click(b);
      await b.wait("document.querySelector('[data-batch-confirm]')");
      assert.equal(await b.evaluate("window.l07.calls.filter(x=>x.action==='executeRecycleBatch').length"),0);
      assert.match(await b.evaluate("document.querySelector('.sheet-overlay').textContent"),/Verified 1000/);
      for(const width of [820,1180]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height:width===820?1180:820,deviceScaleFactor:2,mobile:false});
        assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
        const shot=await b.send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(ROOT,`tests/security/.results/l07-${lang}-${width}.png`),Buffer.from(shot.data,'base64'));
      }
      await b.evaluate("(()=>{const c=document.querySelector('[data-batch-confirm]');c.click();c.click()})()");
      await b.wait("document.querySelector('[data-batch-retry]')");
      assert.equal(await b.evaluate("window.l07.calls.filter(x=>x.action==='executeRecycleBatch').length"),1);
      assert.equal(await b.evaluate("document.querySelectorAll('.recycle-batch-receipt [data-result-code=RESTORED]').length"),2);
      await b.evaluate("window.l07.fail=false;document.querySelector('[data-batch-retry]').click()");
      await b.wait("document.querySelector('[data-batch-confirm]')");
      assert.deepEqual(await b.evaluate("window.l07.calls.filter(x=>x.action==='previewRecycleBatch').at(-1).data.items"),[{kind:'customer',id:1001}]);
      await b.evaluate("document.querySelector('[data-batch-confirm]').click()");
      await b.wait("!document.querySelector('.sheet-overlay') && !document.querySelector('[data-batch-retry]')");
      assert.equal(await b.evaluate("window.l07.calls.filter(x=>['restore','restorePersonOnlyRecruit'].includes(x.action)).length"),0);
    }
    await b.healthy();
  }finally{await b.close();}
});
test('L07 lost response reads persisted receipt; unexecuted recovery asks for a new human confirmation',async()=>{
  const b=new Browser(ROOT);
  try{
    await b.start();await setup(b);
    await b.evaluate("window.l07.network=true;window.l07.fail=false;document.querySelector('tbody input').click()");await click(b);
    await b.wait("document.querySelector('[data-batch-confirm]')");
    await b.evaluate("document.querySelector('[data-batch-confirm]').click()");
    await b.wait("document.querySelector('[data-batch-read]') && !document.querySelector('.sheet-overlay')");
    await b.evaluate("window.l07render(window.l07ctx)");
    await b.wait("document.querySelector('.recycle-batch-receipt [data-result-code=RESTORED]')");
    assert.equal(await b.evaluate("window.l07.calls.filter(x=>x.action==='executeRecycleBatch').length"),1);
    assert.equal(await b.evaluate("sessionStorage.getItem('crm_recycle_receipt_customer')"),null);
    await b.evaluate("window.l07.unexecuted=true;document.querySelector('tbody input').click()");await click(b);
    await b.wait("document.querySelector('[data-batch-confirm]')");
    await b.evaluate("document.querySelector('[data-batch-confirm]').click()");
    await b.wait("document.querySelector('[data-batch-read]') && !document.querySelector('.sheet-overlay')");
    await b.evaluate("window.l07render(window.l07ctx)");
    await b.wait("document.querySelector('[data-batch-confirm]')");
    assert.equal(await b.evaluate("window.l07.calls.filter(x=>x.action==='executeRecycleBatch').length"),2);
    await b.evaluate("window.l07.network=false;window.l07.unexecuted=false;document.querySelector('[data-batch-confirm]').click()");
    await b.wait("document.querySelector('.recycle-batch-receipt [data-result-code=RESTORED]') && !document.querySelector('.sheet-overlay')");
    assert.equal(await b.evaluate("window.l07.calls.filter(x=>x.action==='executeRecycleBatch').length"),3);
    await b.healthy();
  }finally{await b.close();}
});
test('L07 recruit selections preserve linked versus Person-only executor type',async()=>{
  const b=new Browser(ROOT);
  try{
    await b.start();await setup(b,'en','recruit');
    await b.evaluate("[...document.querySelectorAll('tbody input')].slice(0,2).forEach(x=>x.click())");await click(b);
    await b.wait("document.querySelector('[data-batch-confirm]')");
    const items=await b.evaluate("window.l07.calls.find(x=>x.action==='previewRecycleBatch').data.items");
    assert.equal(items[0].kind,'person_recruit');assert.equal(items[0].id,2001);assert.equal(items[1].kind,'recruit');
    await b.healthy();
  }finally{await b.close();}
});
test('L07 a stale list response cannot clear selection or replace a newer filtered page',async()=>{
  const b=new Browser(ROOT);
  try{
    await b.start();await setup(b);
    await b.evaluate("window.l07.delay=true;document.querySelector('input[type=search]').value='slow';document.querySelector('.search-form').dispatchEvent(new Event('submit',{cancelable:true}))");
    await b.wait("typeof window.l07.resolve==='function'");
    await b.evaluate("document.querySelector('input[type=search]').value='fast';document.querySelector('.search-form').dispatchEvent(new Event('submit',{cancelable:true}))");
    await b.wait("document.querySelectorAll('tbody tr').length===20");
    await b.evaluate("document.querySelector('tbody input').click();window.l07.resolve()");
    await b.wait("!document.querySelector('[data-batch-preview]').disabled");
    await click(b);await b.wait("document.querySelector('[data-batch-confirm]')");
    assert.deepEqual(await b.evaluate("window.l07.calls.find(x=>x.action==='previewRecycleBatch').data.items"),[{kind:'customer',id:1000}]);
    await b.healthy();
  }finally{await b.close();}
});
