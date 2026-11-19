'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('iPad bilingual row dropdown saves exact versions independently, handles failure, retries same source and preserves paging',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  const checks=await b.evaluate(`(async()=>{
   const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js'),{data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const wait=()=>new Promise(r=>setTimeout(r,30)),checks=[],calls=[],pending=new Map();
   const version=(id,source)=>({id,source,title:'Synthetic title',preview:'Complete question and respectful response.',created_at:'2026-11-19T01:00:00Z'});
   for(const language of ['zh-CN','en']){
    lang.setLang(language);const records=Array.from({length:22},(_,i)=>({id:i+1,scenario:'Synthetic '+(i+1),response_logic:'Original '+(i+1),metadata:{kind:'wording',keywords:[],enabled:true}}));
    const states=records.map(r=>({entry_id:r.id,current_id:r.id,manual_version_id:r.id,selection_mode:'current',updated_at:'2026-11-19T01:00:00Z',current_version:version(r.id,'original'),manual_version:version(r.id,'original'),gpt_version:version(r.id+100,'gpt'),system_version:null}));
    data.knowledgeLibrary=async(_ctx,op,payload)=>{
     const {referenceOperation:action,data:input}=payload;calls.push(action);
     if(op==='referenceMaintenance')return {rows:records.map(r=>({...r}))};
     if(action==='states')return {rows:states.filter(s=>!input.id||s.entry_id===input.id).map(s=>structuredClone(s))};
     if(action==='selectMode')return new Promise((resolve,reject)=>pending.set(input.id,{input,resolve,reject}));
     throw Error('Unexpected '+action);
    };
    const main=document.querySelector('.console-main');renderCommunicationReferences({main});await wait();
    const row=id=>main.querySelector('[data-reference-id="'+id+'"]');
    const open=async id=>{row(id).querySelector('.ro-selector-toggle').click();await wait();return document.querySelector('.ro-selector-popup');};
    const succeed=async id=>{const req=pending.get(id),s=states[id-1],v=req.input.mode==='current'?s.manual_version:s.gpt_version;
     s.current_id=v.id;s.current_version=v;s.selection_mode=req.input.mode;s.pinned=true;s.updated_at='2026-11-19T01:01:00Z';records[id-1].response_logic=v.preview;
     pending.delete(id);req.resolve({state:structuredClone(s),row:{...records[id-1]}});await wait();};
    let popup=await open(1);checks.push(popup.querySelectorAll('[data-mode]').length===3&&popup.querySelector('[data-mode=system]').disabled);
    checks.push(popup.textContent.includes(lang.t('ro_selector_hint'))&&popup.textContent.includes('Complete question'));
    const bounds=popup.getBoundingClientRect();checks.push(bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight);
    popup.querySelector('[data-mode=gpt]').click();await wait();
    checks.push(row(1).querySelector('.ro-selector-toggle').disabled&&!row(2).querySelector('.ro-selector-toggle').disabled);
    const unloading=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unloading);checks.push(unloading.defaultPrevented);
    const beforeHref=location.href,confirmOriginal=window.confirm;let leavePrompts=0;
    window.confirm=()=>{leavePrompts++;return false;};main.querySelector('a[href]').click();window.confirm=confirmOriginal;
    checks.push(location.href===beforeHref&&leavePrompts===1);
    checks.push(pending.get(1).input.versionId===101&&pending.get(1).input.expectedCurrentId===1);
    popup=await open(2);popup.querySelector('[data-mode=gpt]').click();await wait();checks.push(pending.size===2);
    await succeed(2);checks.push(row(1).querySelector('.ro-selector-toggle').disabled&&row(2).textContent.includes(lang.t('ro_saved')));
    await succeed(1);checks.push(row(1).querySelector('.ro-selector-toggle').textContent.includes(lang.t('ro_selector_gpt')));
    const completedUnload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(completedUnload);checks.push(!completedUnload.defaultPrevented);
    states[0].gpt_version=version(301,'gpt');popup=await open(1);popup.querySelector('[data-mode=gpt]').click();await wait();checks.push(pending.get(1).input.versionId===301);await succeed(1);
    popup=await open(1);popup.querySelector('[data-mode=current]').click();await wait();checks.push(pending.get(1).input.versionId===1);await succeed(1);
    popup=await open(3);popup.querySelector('[data-mode=gpt]').click();await wait();pending.get(3).reject(Object.assign(Error('conflict'),{code:'REFERENCE_STALE'}));pending.delete(3);await wait();
    checks.push(row(3).textContent.includes(lang.t('ro_selector_stale'))&&!row(3).querySelector('.ro-selector-toggle').disabled&&states[2].current_id===3);
    row(3).querySelector('.ro-selector-retry').click();await wait();document.querySelector('[data-mode=gpt]').click();await wait();await succeed(3);
    const next=[...main.querySelectorAll('.kg-pager button')].find(x=>x.textContent===lang.t('kr_next'));next.click();await wait();
    popup=await open(21);popup.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));checks.push(!document.querySelector('.ro-selector-popup')&&document.activeElement===row(21).querySelector('.ro-selector-toggle'));
    popup=await open(21);popup.querySelector('[data-mode=gpt]').click();await wait();await succeed(21);
    checks.push(main.querySelector('.kg-pager').textContent.includes('2 / 2')&&!!row(21));
    checks.push(main.querySelector('.kg-table-wrap').scrollWidth<=main.querySelector('.kg-table-wrap').clientWidth+2);
    checks.push(states.every(s=>!s.want_gpt&&!s.want_system));
   }
   checks.push(!calls.includes('start')&&!calls.includes('flags'));return checks;
  })()`);assert.ok(checks.every(Boolean),JSON.stringify(checks));
  await b.send('Emulation.setDeviceMetricsOverride',{width:820,height:1180,deviceScaleFactor:1,mobile:false});
  const fits=await b.evaluate("document.documentElement.scrollWidth<=innerWidth+2&&document.querySelector('.kg-table-wrap').scrollWidth<=document.querySelector('.kg-table-wrap').clientWidth+2");assert.equal(fits,true);
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../regression/.results/reference-selector-ipad.png'),Buffer.from(shot.data,'base64'));
  await b.evaluate("document.querySelector('.ro-selector-toggle').click()");await b.wait("document.querySelector('.ro-selector-choice')");
  const popupShot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../regression/.results/reference-selector-popup-ipad.png'),Buffer.from(popupShot.data,'base64'));
 }finally{await b.close();}
});
