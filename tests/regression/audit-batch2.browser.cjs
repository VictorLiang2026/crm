'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('./browser.cjs');
const root = path.resolve(__dirname, '../..');

for (const width of [1440, 820, 390]) {
  test('audit 03–08 at ' + width, async () => {
    const b = new Browser(root);
    const e = expr => b.evaluate(expr);
    const wait = expr => b.wait(expr);
    const click = selector => e('document.querySelector('+JSON.stringify(selector)+').click()');
    const nav = hash => e('location.hash='+JSON.stringify(hash));
    const metrics = height => b.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width===390});
    try {
      await b.start();
      if(width!==1440) await b.send('Network.setUserAgentOverride',{userAgent:width===390
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
      await metrics(820);
      await b.openConsole('#/people','authCase=1');
      await wait("document.querySelector('.people-col-name a')");
      assert.equal(await e("window.__crmTest.calls.filter(c=>c.action==='listPeople').length"),1);
      await nav('#/more');
      await wait("document.querySelector('.more-primary')");
      await e("(" + (async function(){
        const {data}=await import('/crm/js/modules/console/data.js');
        data.recruitGoals=async()=>({rows:[{stage:'新增人才',target_count:3}]});
        data.recruitProgress=async()=>({rows:[{stage:'新增人才',actual:1,target:3}],trends:[],overall:{new_count:1,sign_count:0,rate:0}});
        data.recruitFunnel=async()=>({rows:[]});
        window.queries=[];window.pages=2;
        data.listPeople=async(_,q)=>{
          queries.push(structuredClone(q));
          if(window.holdList) await new Promise(resolve=>window.releaseList=resolve);
          return {rows:q.page>pages?[]:Array.from({length:25},()=>({id:980001,display_name:'Test',roles:q.roles})),
            total:pages*25,totalPages:pages,hasMore:q.page<pages,page:q.page};
        };
        data.actionCenter=async(_,q)=>({rows:Array.from({length:20},(_,i)=>({
          id:10+i,person_id:i===0?null:980001,person_name:'Test',title:'Action',status:'open'})),total:40,hasMore:q.page===1});
      }).toString()+")()");
      await nav('#/people/customer/review');
      await wait("document.querySelector('.people-directory-table tbody')");
      assert.equal(await e("queries.length"),1);
      await click('.people-filter-trigger');
      await click('.people-filter-priorities [data-filter-value="A"] input');
      await e("document.querySelector('.people-directory-search input').value='Test'");
      await click('.people-filter-actions button:last-child');
      await wait("document.querySelector('th.people-col-name')");
      await click('th.people-col-name');
      await wait("document.querySelector('.people-directory-table')");
      await click('.pager button:last-child');
      await wait("document.querySelector('.pager-info')?.textContent==='2 / 2'");
      await e("window.scrollTo(0,250);window.testTop=scrollY;window.before=queries.length");
      assert.ok(await e("testTop>0"));
      await click('.people-col-name a');
      await wait("!document.querySelector('.people-directory-views')");
      await e("history.back()");
      await wait("document.querySelector('.pager-info')?.textContent==='2 / 2' && Math.abs(scrollY-testTop)<=1");
      assert.deepEqual(await e("({calls:queries.length-before,roles:queries.at(-1).roles,priority:queries.at(-1).customerPriorities,sort:queries.at(-1).sortField,policy:queries.at(-1).policyFilter,kw:queries.at(-1).keyword})"),
        {calls:1,roles:['customer'],priority:['A'],sort:'display_name',policy:'review',kw:'Test'});
      await e("history.forward()");
      await wait("!document.querySelector('.people-directory-views')");
      await e("window.pages=1;history.back()");
      await wait("document.querySelector('.pager-info')?.textContent==='1 / 1'");
      await click('[data-directory-view="recruit"]');
      await wait("document.querySelector('.people-col-name a')");
      await click('.people-col-name a');
      await wait("!document.querySelector('.people-directory-views')");
      await nav('#/people');
      await wait("document.querySelector('[data-directory-view=recruit]')?.getAttribute('aria-pressed')==='true'");
      await click('[data-directory-view=""]');
      await wait("queries.at(-1).keyword==='' && queries.at(-1).roles.length===0");
      await e("window.holdList=true;document.querySelector('.people-directory-search button').click()");
      await wait("window.releaseList");
      await nav('#/actions/overdue');
      await wait("document.querySelector('[data-action-id]')");
      await e("releaseList()");
      assert.equal(await e("document.querySelector('.people-directory-table')"),null);
      assert.equal(await e("document.querySelector('[data-action-id=\"10\"] .row-sub a')"),null);
      assert.equal(await e("document.querySelector('[data-action-id=\"11\"] .row-title a').hash"),'#/actions/11');
      await click('.opp-pagination button:last-child');
      await wait("document.querySelector('.opp-pagination button:last-child').disabled");
      await e("window.scrollTo(0,180);window.actionTop=scrollY");
      await click('[data-action-id="11"] .row-sub a');
      await wait("location.hash==='#/person/980001/timeline' && !document.querySelector('.opp-pagination')");
      await e("history.back()");
      await wait("document.querySelector('.opp-pagination button:last-child')?.disabled && Math.abs(scrollY-actionTop)<=1");

      // Real renderers, isolated service responses. Exercise both languages and the phone keyboard viewport.
      for(const language of ['zh-CN','en']){
        await e("(async()=>{(await import('/crm/js/modules/console/i18n.js')).setLang("+JSON.stringify(language)+")})()");
        await nav('#/recruit/goals');
        await wait("document.querySelector('.recruit-analysis-filter-controls button')");
        await wait("document.querySelector('.recruit-analysis-details') && document.querySelector('.l06-goal-fields')");
        await click('.recruit-analysis-details summary');
        const widthReport=()=>e("({page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");
        assert.deepEqual((await widthReport()).page,(await widthReport()).viewport,'recruit page fits');
        assert.ok(await e("[...document.querySelectorAll('.recruit-analysis-filter-controls input,.recruit-analysis-filter-controls button')].every(el=>el.getBoundingClientRect().right<=innerWidth)"));
        await e("(" + (async function(){
          const {data}=await import('/crm/js/modules/console/data.js');
          window.rows=[];window.mode='ok';window.writes=0;
          window.doc={parts:[{part:1,start:1,end:30,summary:'Fixture'}],pages:55,basis:'fixture',gptVersion:0,gpt:''};
          data.knowledgeLibrary=async(_,op,{data:input}={})=>{
            if(op==='list')return {knowledge:rows};
            if(op==='documentOverview'){if(mode==='offline')throw Error('offline');return {...doc};}
            if(op==='documentGpt'){
              writes++;
              if(mode==='changed'){doc.gpt='Concurrent';doc.gptVersion++;throw Error('conflict');}
              doc.gpt=input.summary;doc.gptVersion++;
              if(mode==='offline')throw Error('lost response');
              return {...doc};
            }
            throw Error('Unexpected '+op);
          };
        }).toString()+")()");
        await nav('#/knowledge-library');
        await wait("document.querySelector('.kg-empty-cell')");
        assert.equal((await widthReport()).page,(await widthReport()).viewport);
        await e("rows.push({id:10,source:'Fixture',metadata:{document:{number:100001,part:1,total:2,start:1,end:30,pages:55,title:'Long'.repeat(50)}}})");
        await nav('#/knowledge-governance');
        await wait("document.querySelector('[data-document-number] button')");
        await e("document.querySelector('.kg-search input').focus()");
        if(width===390)await metrics(440);
        assert.equal((await widthReport()).page,(await widthReport()).viewport);
        assert.ok(await e("document.querySelector('.kg-pager').getBoundingClientRect().right<=innerWidth"));
        if(width===390){
          assert.ok(await e("document.querySelector('.kg-table-wrap').scrollWidth>document.querySelector('.kg-table-wrap').clientWidth"));
          await metrics(820);
        }
        await click('[data-document-number] button');
        await wait("document.querySelector('.kg-document-summary-text')");
        const draft='  中，文  and English.\n\n    第三段。\n';
        const startEdit=()=>click('.kg-document-overview > div:last-child button:last-child');
        const save=()=>click('.kg-document-summary-editor + p + button');
        await startEdit();
        await e("document.querySelector('textarea').value="+JSON.stringify(draft));
        await save();
        await wait("!document.querySelector('.kg-document-summary-editor')");
        assert.equal(await e("document.querySelector('.kg-document-summary-text').textContent"),draft);
        assert.equal(await e("getComputedStyle(document.querySelector('.kg-document-summary-text')).whiteSpace"),'pre-wrap');
        assert.match(await e("document.querySelector('.kg-document-overview [role=status]').textContent"),/1/);
        await startEdit();
        await e("mode='changed';document.querySelector('textarea').value='my draft'");
        await save();
        await wait("document.querySelector('.kg-document-summary-text').textContent==='Concurrent'");
        assert.equal(await e("document.querySelector('textarea').value"),'my draft');
        await e("mode='offline'");
        await save();
        await wait("document.querySelector('textarea').readOnly");
        await e("mode='ok'");
        await click('.kg-document-summary-editor + p + button');
        await wait("!document.querySelector('textarea')");
        assert.equal(await e("writes"),3,'read verification did not write again');
        assert.equal(await e("document.querySelector('.kg-document-summary-text').textContent"),'my draft');
      }
      await nav('#/settings');
      await wait("document.querySelector('.lang-btn:not(.active)')");
      await e("window.settingsMain=document.querySelector('#console-main');document.querySelector('.lang-btn:not(.active)').click()");
      await wait("window.settingsMain!==document.querySelector('#console-main') && document.querySelector('.lang-btn.active')");
      await b.healthy();
    } finally {await b.close();}
  });
}
