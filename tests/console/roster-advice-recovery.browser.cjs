'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

for (const [device,width,height] of [['desktop',1440,900],['iPad',820,1180],['iPhone',390,844]]) {
  test(device+' roster row review and current/history read states', async () => {
    const b = new Browser(path.resolve(__dirname,'../..'));
    try {
      await b.start();
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:device==='iPhone'});
      await b.send('Emulation.setTouchEmulationEnabled',{enabled:device!=='desktop'});
      await b.openConsole('#/more','authCase=1');
      await b.wait("document.querySelector('.more-primary')");
      await b.evaluate(String.raw`(async()=>{
        const {renderRoster}=await import('/crm/js/modules/console/activity-roster.js');
        const main=document.querySelector('#console-main');
        window.p1={scans:0,prepared:null};
        renderRoster({main,api:{call:async(name,e)=>{
          if(name==='activities')return {rows:[{id:1,name:'Fixture'}]};
          if(e.operation==='list')return {rows:[],total:0};
          if(e.operation==='analyze'){
            p1.scans++;
            return {rows:e.data.rows.map(r=>({...r,candidates:[],profiles:r.values.display_name==='乙'?[{id:7,display_name:'乙',school:'原校'}]:[]}))};
          }
          if(e.operation==='prepare'){p1.prepared=e.data.rows;return {previewId:'p',rows:e.data.rows,newCount:0,existing:1};}
          throw Error('unexpected '+e.operation);
        }}},'1');
      })()`);
      await b.wait("document.querySelector('main input[type=file]')");
      await b.evaluate(String.raw`(()=>{const dt=new DataTransfer();dt.items.add(new File(['姓名,学校\n甲,A\n乙,B\n丙,C'],'test.csv'));
        const input=document.querySelector('main input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));
      })()`);
      await b.wait("[...document.querySelectorAll('button')].some(n=>n.textContent==='核对名单')");
      await b.click('main button','核对名单');
      await b.wait("document.querySelectorAll('option[value=skip]').length===3");
      await b.evaluate(`window.row=i=>[...document.querySelectorAll('option[value=skip]')][i].closest('.card');
        window.change=(i,name)=>{const n=row(i);n.querySelector('input').value=name;n.querySelector('button').click()};
        const pick=row(0).querySelector('select');pick.value='skip';pick.dispatchEvent(new Event('change'));
        row(1).querySelector('.button-row input[type=checkbox]').click();
        change(2,'丁');`);
      await b.wait("row(2).querySelector('strong').textContent.includes('丁')");
      assert.equal(await b.evaluate("row(0).querySelector('select').value"),'skip');
      assert.equal(await b.evaluate("row(1).querySelector('.button-row input[type=checkbox]').checked"),true);
      await b.evaluate("change(2,'乙')");
      await b.wait("row(2).querySelector('strong').textContent.includes('乙')");
      const manual="row(1).querySelector('input[type=checkbox]')";
      assert.equal(await b.evaluate(manual+'.checked'),false);
      await b.click('main button','预览变更');
      assert.equal(await b.evaluate('p1.prepared'),null);
      await b.evaluate("change(2,'戊')");
      await b.wait("row(2).querySelector('strong').textContent.includes('戊')");
      await b.evaluate("for(const i of [1,2]){for(const label of row(i).querySelectorAll('label')){if(label.textContent.includes('我已人工核对'))label.querySelector('input').click()}}");
      await b.click('main button','预览变更');
      await b.wait('p1.prepared?.length===3');
      assert.deepEqual(await b.evaluate('p1.prepared.map(r=>[r.values.display_name,r.choice])'),[['甲','skip'],['乙','profile'],['戊','independent']]);

      await b.evaluate(`(async()=>{
        const {renderFollowupAdvice}=await import('/crm/js/modules/console/followup-advice.js');
        const {data}=await import('/crm/js/modules/console/data.js');
        window.readCase=(current,history)=>{
          const modes={current,history},calls={current:0,history:0};
          window.readTest={modes,calls};
          const fetch=async k=>{calls[k]++;if(modes[k]==='error')throw Error('fixture');
            if(modes[k]==='empty')return {rows:[]};
            return {rows:k==='history'?[{createdAt:'2026-11-15',candidates:[{candidate:{summary:'Saved fixture'}}]}]:
              [{title:'Current fixture',updatedAt:'2026-11-15',system:{version:1,status:'ready'},gpt:{status:'pending'}}]};};
          data.dualFollowupHistory=()=>fetch('history');data.followupAdviceList=()=>fetch('current');
          renderFollowupAdvice({main:document.querySelector('main')},'42');
        };
      })()`);
      for(const current of ['empty','ready','error'])for(const history of ['empty','ready','error']){
        await b.evaluate('readCase('+JSON.stringify(current)+','+JSON.stringify(history)+')');
        await b.wait("readTest.calls.current===1 && readTest.calls.history===1 && !document.querySelector('.fa-list [role=status]')?.textContent.includes('加载中')");
        assert.equal(await b.evaluate("!!document.querySelector('.fa-list > .fa-empty')"),current==='empty'&&history==='empty');
        assert.equal(await b.evaluate("!!document.querySelector('.fa-row')"),current==='ready');
        assert.equal(await b.evaluate("document.querySelector('.fa-legacy')?.textContent.includes('Saved fixture')||false"),history==='ready');
        const notices=await b.evaluate("document.querySelector('main').innerText");
        assert.equal(notices.includes('当前跟进建议读取失败'),current==='error');
        assert.equal(notices.includes('历史跟进建议读取失败'),history==='error');
        if(history==='error'){
          await b.evaluate("readTest.modes.history='ready';[...document.querySelectorAll('main [role=status]')].find(n=>n.textContent.includes('历史跟进建议读取失败')).querySelector('button').click()");
          await b.wait("document.querySelector('.fa-legacy-row')");
          assert.deepEqual(await b.evaluate('readTest.calls'),{current:1,history:2});
        }
      }
      assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      await b.healthy();
    } finally { await b.close(); }
  });
}
