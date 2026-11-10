const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('six directory lists preserve role, event and navigation contracts across languages and devices', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/ai');
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    await b.wait("!!document.querySelector('link[href=\"/crm/css/console.css\"]')?.sheet");
    for (const [width,height] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});
      for (const lang of ['zh-CN','en']) {
        await b.evaluate(`(async()=>{
          const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
          const {setLang}=await import('/crm/js/modules/console/i18n.js');
          setLang('${lang}');
          document.querySelector('#directory-fixture')?.remove();
          for (const el of document.body.children) el.style.display='none';
          const main=document.createElement('main');main.id='directory-fixture';document.body.append(main);
          window.lastRequest=null;
          renderPeople({main,toast(){},api:{async call(name,args){
            window.lastRequest=args;
            return {page:1,pageSize:30,total:1,totalPages:1,rows:[{id:7,display_name:'Demo',roles:['participant','speaker'],
              activity_count:2,latest_activity_id:15,latest_activity_date:'2026-09-18',latest_activity_name:'Demo Event',latest_activity_status:'invited'}]};
          }}});
        })()`);
        assert.equal(await b.evaluate("document.querySelectorAll('[data-directory-view]').length"),6);
        for (const role of ['customer','recruit','referrer','speaker','participant','']) {
          await b.evaluate(`document.querySelector('[data-directory-view="${role}"]').click()`);
          await b.wait(`document.querySelector('.people-table tbody tr') && JSON.stringify(window.lastRequest.roles)===${JSON.stringify(JSON.stringify(role?[role]:[]))}`);
          assert.deepEqual(await b.evaluate("Array.from(document.querySelectorAll('[data-directory-view][aria-pressed=true]'),b=>b.dataset.directoryView)"),[role]);
          if (role==='participant') {
            assert.equal(await b.evaluate("document.querySelector('td.people-col-activity_count').textContent"),'2');
            assert.equal(await b.evaluate("document.querySelector('td.people-col-activity_status').textContent"),lang==='en'?'Invited':'已邀约');
            assert.equal(await b.evaluate("document.querySelector('td.people-col-latest_activity a').getAttribute('href')"),'#/activity/15');
          }
        }
        assert.equal(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
      }
    }
    await b.healthy();
  } finally {await b.close();}
});
