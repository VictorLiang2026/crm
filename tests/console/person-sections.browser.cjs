const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person routes preserve the selected content and expose business sections for active profiles only', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/people','authCase=1');
    await b.wait("document.querySelector('.console-main')");
    await b.evaluate(`(async()=>{
      const {dispatch}=await import('/crm/js/modules/console/router.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      window.wp2=(suffix, customer, recruit, lang='zh-CN')=>{
        setLang(lang);
        window.wp2calls=[];
        dispatch('#/person/71'+suffix,{main:document.querySelector('.console-main'),toast(){},api:{async call(name,args){
          window.wp2calls.push(args.action);
          if(args.action==='getCustomerProfile') return {status:customer?'linked':'person_only', customerId:customer?'81':null,
            fields:{customer_name:'Demo',recruit_id:recruit?'91':null,tags:'Fixture tag'}};
          if(args.action==='get') return {person:{display_name:'Demo'}};
          if(args.action==='listOpportunities') return {rows:[{id:8,person_id:71,opportunity_type:'insurance'}]};
          if(args.action==='getOpportunityDirectoryDetails') return {opportunity:{id:8,person_id:71,person:{id:71,display_name:'Demo'}}};
          return {rows:[],ok:true};
        }}});
      };
    })()`);
    for(const [customer,recruit] of [[true,true],[false,false],[true,false],[false,true]]) {
      await b.evaluate(`wp2('',${customer},${recruit})`);
      await b.wait("document.querySelector('.page-head')?.innerText.includes('Demo') || document.querySelector('.console-main').innerText.includes('Demo')");
      assert.equal(await b.evaluate("document.querySelectorAll('.person-sections button').length"),5+Number(customer)+Number(recruit));
      assert.equal(await b.evaluate("!!document.querySelector('.person-sections [data-person-section=customer]')"),customer);
      assert.equal(await b.evaluate("!!document.querySelector('.person-sections [data-person-section=team]')"),recruit);
      assert.equal(await b.evaluate("window.wp2calls.filter(x=>x==='getCustomerProfile').length"),1);
    }
    for(const [route,group,part] of [['timeline','timeline'],['insurance','customer','insurance'],['relationships','relationships','relationships'],
      ['opportunities','overview','opportunities'],['recruit','team'],['care','materials','care'],['ocr','materials','ocr']]) {
      await b.evaluate(`wp2('/${route}',true,true)`);
      await b.wait(`document.querySelector('.person-sections [aria-pressed=true]')?.dataset.personSection==='${group}'`);
      if(part) await b.wait(`document.querySelector('.person-subsections [aria-pressed=true]')?.dataset.personSection==='${part}'`);
      if(route==='opportunities') {
        await b.wait("document.querySelector('.tabs-body .list-row button')");
        await b.evaluate("document.querySelector('.tabs-body .list-row button').click()");
        await b.wait("document.querySelector('.sheet-overlay .opp-detail-core')");
        assert.ok(await b.evaluate("wp2calls.includes('getOpportunityDirectoryDetails')"));
        await b.evaluate("document.querySelector('.sheet-overlay').remove()");
      }
    }
    for(const [lang,label] of [['zh-CN','客户经营'],['en','Customer Care']]) {
      await b.evaluate(`wp2('/customer',true,true,'${lang}')`);
      await b.wait("document.querySelector('.tabs-body')?.innerText.includes('Fixture tag')");
      assert.equal(await b.evaluate("document.querySelector('.person-sections [aria-pressed=true]').textContent"),label);
      for(const [width,height] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]) {
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1 && Array.from(document.querySelectorAll('.person-sections button')).every(b=>b.getBoundingClientRect().height>=44)"));
      }
    }
    for(const route of ['insurance','recruit']) {
      await b.evaluate(`wp2('/${route}',false,false)`);
      await b.wait("document.querySelector('.console-main .sheet-note')?.textContent.includes('有效')");
      assert.equal(await b.evaluate("document.querySelector('.person-sections [aria-pressed=true]').dataset.personSection"),'overview');
      assert.equal(await b.evaluate("wp2calls.some(x=>['getInsuranceContext','listRecruitContext'].includes(x))"),false);
    }
    await b.healthy();
  } finally { await b.close(); }
});
