'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('iPad reference layout keeps actions horizontal and dropdown usable through scroll, touch, delay and viewport edges',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:820,height:1180,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')",20000);
  await b.evaluate(`(async()=>{
   const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js'),{data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const rows=Array.from({length:22},(_,i)=>({id:i+1,scenario:'话术排版验收 Long reference title '+(i+1),response_logic:'Synthetic only',metadata:{kind:'wording',keywords:['沟通','First contact','LONGKEYWORDWITHOUTSPACES0123456789'],enabled:true}}));
   const version=(id,source)=>({id,source,preview:'Synthetic reference preview. 尊重对方意愿。',created_at:'2026-11-19T01:00:00Z'});
   const states=rows.map(r=>({entry_id:r.id,current_id:r.id,selection_mode:'current',updated_at:'2026-11-19T01:00:00Z',current_version:version(r.id,'original'),manual_version:version(r.id,'original'),gpt_version:version(r.id+100,'gpt'),system_version:version(r.id+200,'system')}));
   window.layoutWrites=[];window.layoutDelay=0;
   data.knowledgeLibrary=async(ctx,op,p)=>{
    if(op==='referenceMaintenance')return {rows};
    if(p.referenceOperation==='states'){await new Promise(r=>setTimeout(r,window.layoutDelay));return {rows:states.filter(s=>!p.data.id||s.entry_id===p.data.id).map(s=>structuredClone(s))};}
    if(p.referenceOperation==='selectMode'){window.layoutWrites.push(p.data);const s=states[p.data.id-1];s.selection_mode=p.data.mode;s.current_id=p.data.versionId;s.current_version=s[p.data.mode==='current'?'manual_version':p.data.mode+'_version'];return {state:structuredClone(s),row:rows[p.data.id-1]};}
    throw Error('Unexpected operation '+p.referenceOperation);
   };
   window.layoutRender=code=>{lang.setLang(code);renderCommunicationReferences({main:document.querySelector('.console-main')});};window.layoutRender('zh-CN');
  })()`);
  await b.wait("document.querySelector('[data-reference-id=\"1\"]')");
  for(const language of ['zh-CN','en'])for(const width of [768,820,1024]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:width===1024?768:1180,deviceScaleFactor:1,mobile:false});
   await b.evaluate(`window.scrollTo(0,0);window.layoutRender(${JSON.stringify(language)})`);
   await b.wait("document.querySelector('[data-reference-id=\"1\"]')");
   const geometry=await b.evaluate(`(()=>{
    const wrap=document.querySelector('.kg-table-wrap'),row=document.querySelector('tbody tr'),buttons=[...row.querySelectorAll('.kr-row-actions button')],rects=buttons.map(x=>x.getBoundingClientRect());
    return {fits:document.documentElement.scrollWidth<=innerWidth+1&&wrap.scrollWidth<=wrap.clientWidth+1,horizontal:rects.every(r=>Math.abs(r.top-rects[0].top)<1),inside:rects.every(r=>r.right<=wrap.getBoundingClientRect().right),text:buttons.every(x=>getComputedStyle(x).whiteSpace==='nowrap'&&x.scrollWidth<=x.clientWidth+1),font:parseFloat(getComputedStyle(row.querySelector('.ro-selector-toggle')).fontSize),touch:rects.every(r=>r.height>=44&&r.width>=44)};
   })()`);
   assert.deepEqual(geometry,{fits:true,horizontal:true,inside:true,text:true,font:15,touch:true},language+' '+width+' '+JSON.stringify(geometry));
  }
  await b.send('Emulation.setDeviceMetricsOverride',{width:820,height:1180,deviceScaleFactor:1,mobile:false});
  await b.evaluate("window.layoutRender('zh-CN')");await b.wait("document.querySelector('[data-reference-id=\"8\"]')");
  // Reproduce the original close-on-queued-scroll bug, including delayed server options.
  await b.evaluate("window.layoutDelay=180;const trigger=document.querySelector('[data-reference-id=\"8\"] .ro-selector-toggle');trigger.scrollIntoView({block:'center'});trigger.click()");
  await b.wait("document.querySelector('.ro-selector-choice')");
  await b.evaluate("window.scrollBy(0,10)");
  await b.wait("document.querySelector('.ro-selector-choice')&&document.querySelector('.ro-selector-popup').getBoundingClientRect().bottom<=innerHeight");
  assert.equal(await b.evaluate("!!document.querySelector('.ro-selector-popup')"),true);
  // Use actual touch input, rather than only DOM .click(), to select the visible GPT option.
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const target=await b.evaluate("(()=>{const r=document.querySelector('[data-mode=gpt]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await b.wait("window.layoutWrites.length===1");assert.equal(await b.evaluate("window.layoutWrites[0].versionId"),108);
  // Edge positioning, internal popup scroll, keyboard dismissal and viewport resize.
  await b.evaluate("document.querySelector('[data-reference-id=\"8\"] .ro-selector-toggle').click()");await b.wait("document.querySelector('.ro-selector-choice')");
  await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.evaluate("document.querySelector('[data-reference-id=\"8\"] .ro-selector-toggle').scrollIntoView({block:'end'})");
  await b.wait("document.querySelector('.ro-selector-popup')&&document.querySelector('.ro-selector-popup').getBoundingClientRect().bottom<=innerHeight");
  const bounds=await b.evaluate("(()=>{const r=document.querySelector('.ro-selector-popup').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()");assert.equal(bounds,true);
  await b.evaluate("document.querySelector('.ro-selector-popup').dispatchEvent(new Event('scroll'));document.querySelector('.ro-selector-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await b.evaluate("!document.querySelector('.ro-selector-popup')&&document.activeElement.matches('.ro-selector-toggle')"),true);
  await b.evaluate("document.querySelector('[data-reference-id=\"8\"] .ro-selector-toggle').click()");await b.wait("document.querySelector('.ro-selector-choice')");
  await b.evaluate("window.scrollTo(0,0)");await b.wait("!document.querySelector('.ro-selector-popup')");
  assert.equal(await b.evaluate("document.querySelectorAll('thead th').length"),5);
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../regression/.results/reference-layout-ipad.png'),Buffer.from(shot.data,'base64'));
  assert.deepEqual(b.runtimeErrors,[]);
 }finally{await b.close();}
});
