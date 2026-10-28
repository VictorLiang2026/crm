'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person editor saves Person, Customer, and Recruit fields with one atomic form submission', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start(); await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {openPersonEdit}=await import('/crm/js/modules/console/write.js');
      window.profileMode='linked';window.personWrites=[];
      const profile={personId:'71',customerId:'81',status:'linked',fields:{
        customer_name:'【系统测试·勿联系】虚构甲',person_updated_at:'2026-10-15T01:00:00Z',updated_at:'2026-10-15T01:01:00Z',
        phone:'',gender:'未知',birthday:null,occupation:'',organization:'',education:'',wx_account:'',source:'',hobbies:'',
        customer_stage:'关系维护',sales_priority:'B',referral_priority:'C',marital_status:'未知',first_contact_date:null,person_notes:'',
        tags:'旧标签',additional_info:'旧备注',annual_income:100,household_income:'',properties_info:'',mbti:'',
        profile:{family:'旧家庭',events:[{name:'旧事件'}]},recruit_id:'91',recruitment_priority:'A',recruit_updated_at:'2026-10-15T01:02:00Z'
      }};
      window.openEditor=()=>openPersonEdit({main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.personWrites.push({name,args});
        if(name==='person_360'&&args.action==='getCustomerProfile')return window.profileMode==='linked'?profile:{...profile,status:'person_only',customerId:null};
        if(name==='person_360'&&args.action==='updatePerson')return {ok:true,updated:true};
        throw Error('unexpected action '+name);
      }}},{personId:'71'});
      window.openEditor();
    })()`);
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('客户经营资料')");
    const visible=await b.evaluate("document.querySelector('.sheet-overlay').innerText");
    for(const text of ['客户标签','客户备注','年收入','家庭收入','房产信息','业务画像事件']) assert.ok(visible.includes(text),`missing field: ${text}`);
    await b.evaluate(`(()=>{
      const field=(label)=>[...document.querySelectorAll('.sheet-field')].find(x=>x.querySelector('label')?.textContent===label)?.querySelector('input,textarea,select');
      field('客户标签').value='新标签';field('客户备注').value='新备注';field('年收入').value='250';
      field('业务画像事件（JSON）').value='[{"name":"新事件"}]';
      [...document.querySelectorAll('.sheet-field')].find(x=>x.querySelector('label')?.textContent==='招募优先级').querySelector('select').value='D';
      window.saveButtonCount=[...document.querySelectorAll('.sheet-overlay button')].filter(x=>x.textContent.trim()==='保存').length;
      window.legacySaveButtons=[...document.querySelectorAll('.sheet-overlay button')].some(x=>/保存客户资料|保存招募优先级/.test(x.textContent));
      [...document.querySelectorAll('.sheet-overlay button')].find(x=>x.textContent.trim()==='保存').click();
    })()`);
    await b.wait("window.personWrites.some(x=>x.args.action==='updatePerson')");
    const call=await b.evaluate("window.personWrites.find(x=>x.args.action==='updatePerson')");
    assert.equal(call.args.data.personId,'71'); assert.equal(call.args.data.expectedUpdatedAt,'2026-10-15T01:00:00Z');
    assert.equal(call.args.data.customerId,'81'); assert.equal(call.args.data.customerExpectedUpdatedAt,'2026-10-15T01:01:00Z');
    assert.equal(call.args.data.customerFields.tags,'新标签'); assert.equal(call.args.data.customerFields.additional_info,'新备注');
    assert.equal(call.args.data.customerFields.annual_income,250); assert.deepEqual(call.args.data.customerFields.profile.events,[{name:'新事件'}]);
    assert.equal(call.args.data.recruitId,'91'); assert.equal(call.args.data.recruitExpectedUpdatedAt,'2026-10-15T01:02:00Z');
    assert.deepEqual(call.args.data.recruitFields,{recruitment_priority:'D'});
    assert.equal(await b.evaluate('window.saveButtonCount'),1); assert.equal(await b.evaluate('window.legacySaveButtons'),false);
    await b.evaluate("window.profileMode='person';window.openEditor()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('没有可用的客户档案')");
    assert.equal(await b.evaluate("[...document.querySelectorAll('.sheet-field label')].some(x=>x.textContent==='客户标签')"),false);
    assert.equal(await b.evaluate("window.personWrites.filter(x=>x.args.action==='updatePerson').length"),1);
    await b.healthy(); assert.deepEqual(b.networkViolations,[]);
  } finally { await b.close(); }
});
test('People directory customer view is additive, keeps the full directory, and fits iPad orientations', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      renderPeople({main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        const customerOnly=args.roles?.length===1&&args.roles[0]==='customer';
        return {rows:[{id:71,display_name:'【系统测试·勿联系】客户甲',roles:['customer'],customer_stage:'关系维护',
          sales_priority:'A',recruitment_priority:null,referral_priority:'B',latest_followup_date:'2026-10-01',
          next_followup_date:'2026-10-20',customer_id:81,recruit_id:null}],page:1,pageSize:20,total:1,totalPages:1,hasMore:false};
      }}});
    })()`);
    await b.wait("document.querySelector('.people-table tbody tr')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    assert.equal(await b.evaluate("document.querySelector('.people-table thead').innerText.includes('客户经营阶段')"), false);
    await b.evaluate("[...document.querySelectorAll('.toolbar button')].find(x=>x.textContent.trim()==='客户经营视图').click()");
    await b.wait("document.querySelector('.people-table thead').innerText.includes('客户阶段')");
    const req = await b.evaluate('window.peopleRequests.at(-1).args');
    assert.deepEqual(req.roles, ['customer']);
    assert.equal(req.includeCustomerStage, true);
    assert.equal(await b.evaluate("document.querySelector('.people-table tbody').innerText.includes('关系维护')"), true);
    for (const [width, height] of [[820,1180],[1180,820]]) {
      await b.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, `${width}x${height} horizontal overflow`);
    }
    await b.evaluate("[...document.querySelectorAll('.toolbar button')].find(x=>x.textContent.trim()==='全部人物').click()");
    await b.wait("window.peopleRequests.at(-1).args.roles.length===0");
    await b.healthy();
    assert.deepEqual(b.networkViolations, []);
  } finally { await b.close(); }
});
