'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('activity, speaker and topic directories navigate directly, search, sort and page on iPad', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.evaluate(`(async()=>{
      const { data } = await import('/crm/js/modules/console/data.js');
      const activities = Array.from({length:75}, (_,i)=>({id:i+1,name:'Fictional Activity '+String(75-i).padStart(2,'0'),
        activity_date:'2026-10-29',activity_type:'salon',location:'Fictional Place',status:'preparing'}));
      const speakers = Array.from({length:65}, (_,i)=>({id:i+1,name:'Fictional Speaker '+String(65-i).padStart(2,'0'),
        organization:'Fictional School',position:'Doctor',relationship_stage:'new',cooperation_count:i,
        last_contact_date:'2026-10-01',next_contact_date:'2026-11-01',status:'active'}));
      const topics = Array.from({length:65}, (_,i)=>({id:i+1,topic_name:'Fictional Topic '+String(65-i).padStart(2,'0'),
        category:'Fictional Category',target_audience:'Fictional Audience',use_count:i,last_used_date:'2026-10-01',status:'active'}));
      window.directoryCase={calls:[]};
      const page=(items,args)=>{
        const field=args.sortField||'id', direction=args.sortDir==='asc'?1:-1;
        const keyword=String(args.keyword||'').toLowerCase();
        const matches=items.filter(row=>!keyword||Object.values(row).some(value=>String(value||'').toLowerCase().includes(keyword)));
        matches.sort((a,b)=>direction*(String(a[field]??'').localeCompare(String(b[field]??''),'zh-CN',{numeric:true})||a.id-b.id));
        const start=(args.page-1)*args.pageSize;
        return {rows:matches.slice(start,start+args.pageSize),page:args.page,pageSize:args.pageSize,
          hasMore:start+args.pageSize<matches.length,total:null};
      };
      data.activityDirectory=async(_,args)=>{window.directoryCase.calls.push({kind:'activity',...args});return page(activities,args)};
      data.resourceDirectory=async(_,kind,args)=>{window.directoryCase.calls.push({kind,...args});return page(kind==='speaker'?speakers:topics,args)};
      location.hash='#/activities';
    })()`);
    await browser.wait("document.querySelector('.activity-directory-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.activity-directory-table tbody tr').length"),30);
    assert.equal(await browser.evaluate("document.querySelector('a[href=\"#/activity-speakers\"]')?.textContent"),'嘉宾资料');
    assert.equal(await browser.evaluate("document.querySelector('a[href=\"#/activity-topics\"]')?.textContent"),'活动主题');
    assert.equal(await browser.evaluate("document.querySelector('a[href=\"#/activity-resources\"]')"),null);
    await browser.evaluate("document.querySelector('.activity-directory-table th:first-child').click()");
    await browser.wait("window.directoryCase.calls.at(-1).kind==='activity'&&window.directoryCase.calls.at(-1).sortField==='id'");
    assert.equal(await browser.evaluate("document.querySelector('.activity-directory-table tbody tr td:first-child').textContent"),'1');
    await browser.evaluate("document.querySelector('.activity-directory-table th:first-child').click()");
    await browser.wait("window.directoryCase.calls.at(-1).sortDir==='desc'");
    assert.equal(await browser.evaluate("document.querySelector('.activity-directory-table tbody tr td:first-child').textContent"),'75');
    await browser.evaluate("document.querySelector('.activity-directory-filters input').value='Activity 01';document.querySelector('.activity-directory-filters').requestSubmit()");
    await browser.wait("window.directoryCase.calls.at(-1).keyword==='Activity 01'");
    assert.equal(await browser.evaluate("document.querySelectorAll('.activity-directory-table tbody tr').length"),1);
    await browser.evaluate("location.hash='#/activity-speakers'");
    await browser.wait("document.querySelector('.resource-directory-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelector('.page-title')?.textContent"),'嘉宾资料');
    assert.equal(await browser.evaluate("document.querySelector('.resource-directory-tabs')"),null);
    await browser.evaluate("document.querySelector('.resource-directory-table th:nth-child(2)').click()");
    await browser.wait("window.directoryCase.calls.at(-1).kind==='speaker'&&window.directoryCase.calls.at(-1).sortField==='name'");
    assert.equal(await browser.evaluate("document.querySelector('.resource-directory-table tbody tr td:nth-child(2)').textContent"),'Fictional Speaker 01');
    await browser.evaluate("document.querySelector('.pager button:last-child').click()");
    await browser.wait("window.directoryCase.calls.at(-1).page===2");
    assert.equal(await browser.evaluate("document.querySelectorAll('.resource-directory-table tbody tr').length"),30);
    await browser.evaluate("location.hash='#/activity-topics'");
    await browser.wait("document.querySelector('.page-title')?.textContent==='活动主题'");
    await browser.evaluate("document.querySelector('.resource-directory-table th:nth-child(5)').click()");
    await browser.wait("window.directoryCase.calls.at(-1).kind==='topic'&&window.directoryCase.calls.at(-1).sortField==='use_count'");
    assert.equal(await browser.evaluate("document.querySelector('.resource-directory-table tbody tr td:nth-child(5)').textContent"),'0');
    await browser.evaluate("document.querySelector('.resource-directory-filters input').value='Topic 01';document.querySelector('.resource-directory-filters').requestSubmit()");
    await browser.wait("window.directoryCase.calls.at(-1).keyword==='Topic 01'");
    assert.equal(await browser.evaluate("document.querySelectorAll('.resource-directory-table tbody tr').length"),1);
    await browser.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');const {renderTopicDirectory}=await import('/crm/js/modules/console/activity-people.js');renderTopicDirectory({main:document.querySelector('#console-main'),toast:()=>{}})})()");
    await browser.wait("document.querySelector('.page-title')?.textContent==='Activity Topics'");
    for (const size of [{width:820,height:1180},{width:1180,height:820}]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    }
    await browser.healthy();
  } finally { await browser.close(); }
});
