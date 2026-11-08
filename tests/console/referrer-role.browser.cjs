'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person profile confirms manual referrer mark and removal, then refreshes its status', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/ai');
    await b.evaluate(`(async()=>{
      const {renderPerson}=await import('/crm/js/modules/console/pages/person.js');
      window.referrerMarked=false;window.roleCalls=[];window.roleToasts=[];
      const main=document.createElement('main');document.body.append(main);
      renderPerson({main,toast:(message)=>window.roleToasts.push(message),api:{call:async(name,args)=>{
        if(name==='person_360'&&args.action==='get')return {person:{id:7,display_name:'【系统测试·勿联系】角色测试'}};
        if(name==='person_360'&&args.action==='getCustomerProfile')return {status:'person_only',fields:{customer_name:'【系统测试·勿联系】角色测试'},
          roles:window.referrerMarked?[{id:51,role:'referrer',origin:'manual'}]:[]};
        if(name==='person_360'&&args.action==='listPersonWorkItems')return {rows:[]};
        if(name==='person_360'&&args.action==='listInteractions')return {rows:[]};
        if(name==='person_360'&&args.action==='setReferrerRole'){
          window.roleCalls.push(args.data);
          if(args.data.expectedEnabled!==window.referrerMarked)throw Error('Person role changed; reload and retry');
          window.referrerMarked=args.data.enabled;
          return {personId:'7',role:'referrer',enabled:window.referrerMarked};
        }
        return {ok:true,hasResult:false};
      }}},'7');
    })()`);
    await b.wait("[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='标记为推荐人')");
    assert.equal(await b.evaluate("document.body.innerText.includes('转介绍优先级不会自动赋予该角色')"), true);
    await b.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='标记为推荐人').click()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('确认标记推荐人')");
    assert.equal(await b.evaluate('window.roleCalls.length'), 0, 'opening review does not write');
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='确认').click()");
    await b.wait("[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='取消推荐人标记')");
    assert.deepEqual(await b.evaluate('window.roleCalls[0]'), {personId:'7',enabled:true,expectedEnabled:false});
    await b.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消推荐人标记').click()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('确认取消推荐人标记')");
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='确认').click()");
    await b.wait("window.roleCalls.length===2 && [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='标记为推荐人')");
    assert.deepEqual(await b.evaluate('window.roleCalls[1]'), {personId:'7',enabled:false,expectedEnabled:true});
    assert.deepEqual(await b.evaluate('window.roleToasts'), ['已标记为推荐人','已取消推荐人标记']);
    await b.healthy();
    assert.deepEqual(b.networkViolations, []);
  } finally { await b.close(); }
});

test('Referrer filter explains its meaning and provides a useful empty state in both languages', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/ai');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.filterRequests=[];
      const main=document.createElement('main');document.body.append(main);
      renderPeople({main,toast(){},api:{call:async(name,args)=>{
        window.filterRequests.push(args);
        return {rows:[],page:1,pageSize:30,total:0,totalPages:1,hasMore:false};
      }}});
    })()`);
    await b.wait("document.querySelector('.people-filter-trigger')");
    await b.evaluate("document.querySelector('.people-filter-trigger').click()");
    assert.equal(await b.evaluate("document.querySelector('.people-filter-panel').innerText.includes('与转介绍优先级不同')"), true);
    await b.evaluate("document.querySelector('.people-filter-check[data-filter-value=referrer] input').click()");
    await b.evaluate("[...document.querySelectorAll('.people-filter-panel button')].find(x=>x.textContent.trim()==='搜索').click()");
    await b.wait("window.filterRequests.at(-1).roles?.[0]==='referrer'");
    await b.wait("document.body.innerText.includes('没有符合条件的推荐人')");
    const translated = await b.evaluate(`(async()=>{
      const {t,setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('en');const values=[t('referrer_filter_explain'),t('referrer_filter_empty'),t('referrer_mark_button')];
      setLang('zh-CN');return values;
    })()`);
    assert.ok(translated.every(value=>/[A-Za-z]/.test(value)));
    await b.healthy();
    assert.deepEqual(b.networkViolations, []);
  } finally { await b.close(); }
});
