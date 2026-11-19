'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('iPhone reference cards keep bilingual content, filters, actions and touch version selection readable',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await b.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')",20000);
  await b.evaluate(`(async()=>{
   const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js'),{data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const rows=Array.from({length:22},(_,i)=>({id:i+1,scenario:'首次沟通：确认对方是否方便交流 — Long reference title '+(i+1),response_logic:'Local fixture only. Respect refusal.',metadata:{kind:'wording',keywords:['初次沟通','LONGKEYWORDWITHOUTSPACES0123456789'],enabled:i!==21}}));
   const v=(id,source)=>({id,source,preview:'Synthetic candidate text for touch verification.',created_at:'2026-11-20T01:00:00Z'});
   const states=rows.map(r=>({entry_id:r.id,current_id:r.id,selection_mode:'current',updated_at:'2026-11-20T01:00:00Z',current_version:v(r.id,'original'),manual_version:v(r.id,'original'),gpt_version:v(r.id+100,'gpt')}));
   window.phoneWrites=[];
   data.knowledgeLibrary=async(ctx,op,p)=>{
    if(op==='referenceMaintenance')return {rows};
    if(p.referenceOperation==='states')return {rows:states.filter(s=>!p.data.id||s.entry_id===p.data.id).map(s=>structuredClone(s))};
    if(p.referenceOperation==='selectMode'){window.phoneWrites.push(p.data);const s=states[p.data.id-1];s.selection_mode=p.data.mode;s.current_id=p.data.versionId;s.current_version=s.gpt_version;return {state:structuredClone(s),row:rows[p.data.id-1]};}
    throw Error('Unexpected operation');
   };
   window.phoneRender=code=>{lang.setLang(code);renderCommunicationReferences({main:document.querySelector('.console-main')});};window.phoneRender('zh-CN');
  })()`);
  for(const language of ['zh-CN','en'])for(const [width,height] of [[320,740],[375,812],[390,844],[430,932],[844,390]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   await b.evaluate(`window.scrollTo(0,0);window.phoneRender(${JSON.stringify(language)})`);await b.wait("document.querySelector('.kr-row-actions')");
   const result=await b.evaluate(`(()=>{const row=document.querySelector('tbody tr'),actions=[...row.querySelectorAll('.kr-row-actions button')],rs=actions.map(x=>x.getBoundingClientRect()),info=row.querySelector('.kr-info-cell').getBoundingClientRect(),version=row.querySelector('.kr-version-cell').getBoundingClientRect(),state=row.querySelector('.kr-state-cell').getBoundingClientRect();return {cards:getComputedStyle(row).display==='grid',fits:document.documentElement.scrollWidth<=innerWidth+1&&[...row.querySelectorAll('button,select,input')].every(x=>x.getBoundingClientRect().right<=innerWidth),horizontal:rs.every(r=>Math.abs(r.top-rs[0].top)<1&&r.height>=44&&r.width>=44),readable:info.width>=180&&version.width>=240&&version.top>=state.bottom,labels:row.querySelector('.kr-version-cell').dataset.label.length>0,font:getComputedStyle(row.querySelector('.ro-selector-toggle')).fontSize,fields:[...document.querySelectorAll('.kg-list-tools input,.kg-list-tools select')].every(x=>parseFloat(getComputedStyle(x).fontSize)>=16)};})()`);
   assert.deepEqual(result,{cards:true,fits:true,horizontal:true,readable:true,labels:true,font:'16px',fields:true},language+' '+width+' '+JSON.stringify(result));
  }
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await b.evaluate("window.phoneRender('zh-CN')");await b.wait("document.querySelector('.kr-row-actions')");
  await b.evaluate("document.querySelector('.kr-info-cell').scrollIntoView({block:'start'})");
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../regression/.results/reference-iphone-card.png'),Buffer.from(shot.data,'base64'));
  await b.evaluate("const trigger=document.querySelector('.ro-selector-toggle');trigger.scrollIntoView({block:'center'});trigger.click()");await b.wait("document.querySelector('.ro-selector-choice')");
  const target=await b.evaluate("(()=>{const r=document.querySelector('[data-mode=gpt]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await b.wait("window.phoneWrites.length===1");assert.equal(await b.evaluate("window.phoneWrites[0].versionId"),101);
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('tbody tr')).display"),'grid');
  await b.evaluate("const s=document.querySelectorAll('.kg-list-tools select')[1];s.value='disabled';s.dispatchEvent(new Event('change'))");
  assert.equal(await b.evaluate("document.querySelector('tbody tr').dataset.referenceId"),'22');
  await b.evaluate("document.querySelector('.kr-reference-title').click()");await b.wait("document.querySelector('.kr-dialog pre')");assert.match(await b.evaluate("document.querySelector('.kr-dialog pre').textContent"),/Local fixture only/);
  await b.evaluate("document.querySelector('.kr-dialog header button').click()");
  assert.deepEqual(b.runtimeErrors,[]);
 }finally{await b.close();}
});
