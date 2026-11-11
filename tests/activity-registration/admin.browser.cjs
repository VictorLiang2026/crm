'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

for(const [device,width,height] of [['desktop',1440,900],['iPad',820,1180],['iPhone',390,844]])
test(device+' registration management, review and explicit Person linking',async()=>{

  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/today');
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:device==='iPhone'});
    const {recipient,seal}=require('../../cloudfunctions/activity_registration/registration-reply');
    await browser.send('Runtime.addBinding',{name:'registrationFixture'});
    browser.socket.addEventListener('message',async message=>{
      const packet=JSON.parse(String(message.data));
      if(packet.method!=='Runtime.bindingCalled'||packet.params.name!=='registrationFixture')return;
      try{
        const {id,key,value}=JSON.parse(packet.params.payload);
        const reply=seal(value,recipient(key));
        await browser.evaluate('window.finishRegistrationFixture('+id+','+JSON.stringify(reply)+')');
      }catch(error){browser.runtimeErrors.push(error.message);}
    });
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const page={id:'11111111-1111-4111-8111-111111111111',activity_id:940001,slug:'activity-940001',status:'published',
        content:{title:'【系统测试·勿联系】公开活动',intro:'说明',coverUrl:'',blocks:[]},form_schema:[]};
      const registration={id:'22222222-2222-4222-8222-222222222222',page_id:page.id,attendee_name:'【系统测试·勿联系】报名人',
        phone:'TEST-0001',wechat:'test-wechat',answers:{},status:'pending',created_at:'2026-10-01T00:00:00Z'};
      window.arTest={calls:[],page,registration,async call(name,data){this.calls.push({name,data});
        if(name==='activities'&&data.action==='list')return {rows:[{id:940001,name:'【系统测试·勿联系】活动',activity_date:'2026-10-20',description:'说明'}]};
        if(name==='activity_registration'&&data.action==='listPages')return {rows:[this.page]};
        if(name==='activity_registration'&&data.action==='listSubmissions')return {rows:[this.registration]};
        if(name==='activity_registration'&&data.action==='searchPersons')return {rows:[{id:980001,display_name:'【系统测试·勿联系】现有人物'}]};
        if(name==='activity_registration'&&data.action==='review'){this.registration.status=data.status;return {ok:true};}
        if(name==='activity_registration'&&data.action==='savePage')return {page:this.page,publicUrl:'https://example.invalid/registration'};
        return {ok:true};
      }};
      const {renderActivityRegistrations}=await import('/crm/js/modules/console/activity-registrations.js');
      const host=document.createElement('main');host.id='ar-admin-test';document.body.append(host);
      let serial=0;const pending=new Map();
      window.finishRegistrationFixture=(id,reply)=>{pending.get(id)(reply);pending.delete(id);};
      window.arAdminRender=renderActivityRegistrations;window.arAdminCtx={main:host,callFn:async(name,data)=>{
        const value=await window.arTest.call(name,data);
        if(name!=='activity_registration')return value;
        const id=++serial;return new Promise(resolve=>{pending.set(id,resolve);window.registrationFixture(JSON.stringify({id,key:data.replyKey,value}));});
      }};
      renderActivityRegistrations(window.arAdminCtx);
    })()`);
    await browser.wait("document.querySelector('#ar-admin-test article.card')");
    const initial = await browser.evaluate("document.querySelector('#ar-admin-test').innerText");
    assert.ok(initial.includes('活动报名管理') || initial.includes('Activity Registration'));
    assert.ok(initial.includes('公开活动'));
    assert.ok(initial.includes('报名人'));

    await browser.evaluate("[...document.querySelectorAll('#ar-admin-test button')].find(el=>el.textContent==='审核通过').click()");
    await browser.wait("window.arTest.calls.some(call=>call.data.action==='review'&&call.data.status==='approved')");
    await browser.wait("document.querySelector('#ar-admin-test input[placeholder=\\\"搜索现有人物姓名\\\"]')");

    await browser.evaluate(`(()=>{
      const input=[...document.querySelectorAll('#ar-admin-test input')].find(el=>el.placeholder==='搜索现有人物姓名');
      input.value='测试人物';
      [...document.querySelectorAll('#ar-admin-test button')].find(el=>el.textContent==='查找人物').click();
    })()`);
    await browser.wait("[...document.querySelectorAll('#ar-admin-test button')].some(el=>el.textContent.includes('现有人物'))");
    await browser.evaluate("[...document.querySelectorAll('#ar-admin-test button')].find(el=>el.textContent.includes('现有人物')).click()");
    await browser.wait("window.arTest.calls.some(call=>call.data.action==='linkPerson')");

    for (const [width,height] of [[390,844],[820,1180],[1180,820],[1440,900]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
      const size=await browser.evaluate("({doc:document.documentElement.scrollWidth,host:document.querySelector('#ar-admin-test').scrollWidth,client:document.querySelector('#ar-admin-test').clientWidth})");
      assert.ok(size.doc<=width+1&&size.host<=size.client+1,`iPad overflow ${JSON.stringify(size)}`);
    }

    const bilingual = await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('en');const title=i18n.t('ar_admin_heading');
      i18n.setLang('zh-CN');return title;
    })()`);
    assert.equal(bilingual,'Activity Registration');
    await browser.healthy();
  } finally { await browser.close(); }
});
