'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('home queues open matching lists and six reporting groups retain their period across desktop, iPad and iPhone',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try{
    await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
    await b.evaluate(`(async()=>{
      const {data}=await import('/crm/js/modules/console/data.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const original=data.businessReport;
      window.r7={calls:[],lang:setLang,fail:false};
      data.businessReport=async(ctx,q)=>{
        r7.calls.push(q);if(r7.fail)throw Error('Fixture report unavailable');
        const result=await original(ctx,q);
        if(q.mode==='home')result.counts.event=1;
        if(q.mode==='list'&&q.queue==='event')return {...result,total:1,rows:[{id:77,person_id:71,person_name:'Test',description:'Fictional event',day:'2026-11-10',action_id:41}]};
        if(q.mode==='report'){result.pipeline.protection.dwellN=0;result.roles.total=2;result.roles.multi=1;}
        return result;
      };
      location.hash='#/today';
    })()`);
    await b.wait("document.querySelectorAll('.business-queues a').length===8");
    const links=await b.evaluate("Object.fromEntries([...document.querySelectorAll('.business-queues a')].map(a=>[a.dataset.queue,a.getAttribute('href')]))");
    assert.equal(links.today,'#/actions/today');assert.equal(links.overdue,'#/actions/overdue');
    await b.evaluate("document.querySelector('[data-queue=event]').click()");
    await b.wait("document.querySelector('[data-business-list=event] a[href=\"#/activity/77\"]')");
    assert.ok(await b.evaluate("!!document.querySelector('[data-business-list=event] a[href=\"#/actions/41\"]')"));
    for(const key of ['protection','recruitment','review','renewal','verify']){
      await b.evaluate("location.hash='#/today'");await b.wait("document.querySelector('.business-queues a')");
      await b.evaluate(`document.querySelector('[data-queue=${key}]').click()`);
      if(['protection','recruitment'].includes(key))await b.wait(`document.querySelector('[data-business-list=${key}] .empty')`);
      else await b.wait(`window.__crmTest.calls.some(c=>c.action==='listPeople'&&c.policyFilter==='${key}') || [...document.querySelectorAll('.console-main select')].some(s=>s.value==='${key}' && document.querySelector('[data-directory-view=customer]')?.getAttribute('aria-pressed')==='true')`);
    }
    for(const lang of ['en','zh-CN']){
      await b.evaluate(`r7.lang('${lang}');location.hash='#/more'`);await b.wait("document.querySelector('.more-primary')");
      await b.evaluate("location.hash='#/analytics'");await b.wait("document.querySelectorAll('[data-business-group]').length===6");
      for(const key of ['protection','recruitment','people','events','actions','policy']){
        await b.evaluate(`document.querySelector('button[data-group=${key}]').click()`);
        assert.deepEqual(await b.evaluate("[...document.querySelectorAll('[data-business-group]:not([hidden])')].map(n=>n.dataset.businessGroup)"),[key]);
        assert.doesNotMatch(await b.evaluate("document.querySelector('[data-business-group]:not([hidden])').innerText"),/undefined|NaN/);
      }
      await b.evaluate("document.querySelector('[data-days=\"7\"]').click()");
      await b.wait("r7.calls.at(-1).days===7 && document.querySelector('[data-business-group=policy]:not([hidden])')");
      for(const [width,height] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
        assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),lang+' '+width);
      }
      assert.ok(await b.evaluate("document.querySelector('a[href=\"#/recruit/goals\"]') && !!document.querySelector('a[href=\"#/activity-report\"]')"));
    }
    await b.evaluate("r7.fail=true;document.querySelector('[data-days=\"90\"]').click()");
    await b.wait("document.querySelector('[data-business-report] .error-box')");
    await b.evaluate("r7.fail=false;document.querySelector('[data-business-report] .error-box button').click()");
    await b.wait("document.querySelectorAll('[data-business-group]').length===6");
    await b.healthy();
  }finally{await b.close();}
});
