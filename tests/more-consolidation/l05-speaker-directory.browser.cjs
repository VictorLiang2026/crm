'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('L05 bilingual directory sends combined filters before paging and distinguishes zero from unknown',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
 await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-section')");
 await b.evaluate(`(async()=>{
  const {data}=await import('/crm/js/modules/console/data.js');
  window.l05={calls:[]};
  data.resourceDirectory=async(ctx,kind,args)=>{
   l05.calls.push({kind,...args});return{rows:[{id:1,name:'Fictional A',person_id:12,linked_person:{id:12,name:'Fictional Person'},status:'active',relationship_stage:'stable',last_contact_date:'2026-10-24',next_contact_date:'2026-10-26',cooperation_count:0},{id:2,name:'Fictional B',status:'inactive',relationship_stage:'new',cooperation_count:null}],hasMore:args.page===1,page:args.page,pageSize:20};
  };
  location.hash='#/activity-resources';
 })()`);
 await b.wait("document.querySelector('.l05-contact-summary')");
 for(const lang of ['zh-CN','en']){
  await b.evaluate(`(async()=>{(await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');(await import('/crm/js/modules/console/activity-people.js')).renderResourceDirectory({main:document.querySelector('#console-main')});})()`);
  await b.wait("document.querySelector('.l05-contact-summary')");
  const text=await b.evaluate("[...document.querySelectorAll('.l05-contact-summary')].map(x=>x.textContent)");
  assert.match(text[0],/2026-10-24/);assert.match(text[0],/: 0/);
  assert.match(text[1],lang==='en'?/Not Recorded/:/未记录/);
  await b.evaluate(`(()=>{const f=document.querySelector('#console-main form'),s=f.querySelectorAll('select');s[1].value='active';s[2].value='stable';s[3].value='next7';f.querySelector('input').value='Fictional';f.requestSubmit();})()`);
  await b.wait("l05.calls.at(-1).due==='next7'&&document.querySelector('.pager')");
  assert.deepEqual(await b.evaluate("l05.calls.at(-1)"),{kind:'speaker',keyword:'Fictional',status:'active',page:1,pageSize:20,stage:'stable',due:'next7'});
  await b.evaluate("document.querySelector('.pager button:last-child').click()");
  await b.wait("l05.calls.at(-1).page===2&&document.querySelector('.pager button:last-child').disabled");
  assert.equal(await b.evaluate("l05.calls.at(-1).due"),'next7');
  for(const [width,height]of[[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
   fs.mkdirSync(path.resolve(__dirname,'../security/.results'),{recursive:true});
   const shot=await b.send('Page.captureScreenshot',{format:'png'});
   fs.writeFileSync(path.resolve(__dirname,`../security/.results/l05-${lang}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.equal(await b.evaluate("document.querySelector('a[href=\"/crm/admin.html#/speakers\"]')"),null);
 }
 await b.healthy();
 }finally{await b.close();}
});

