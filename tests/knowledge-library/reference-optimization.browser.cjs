'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('iPad bilingual optimization keeps flags independent, previews before adopting and edits historical versions',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  const result=await b.evaluate(`(async()=>{
   const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js'),{data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const calls=[],checks=[],record={id:7,scenario:'Synthetic budget',response_logic:'Current wording.',metadata:{kind:'objection',keywords:['budget']}};
   let current=1;const state={entry_id:7,current_id:1,want_system:false,want_gpt:false,newCount:1};
   data.knowledgeLibrary=async(_ctx,op,payload)=>{
    calls.push([op,payload]);const {referenceOperation:action,data:input}=payload;
    if(op==='referenceMaintenance')return {ok:true,rows:[record]};
    if(action==='states')return {ok:true,rows:[state]};
    if(action==='flags'){state['want_'+input.lane]=input.enabled;return {ok:true};}
    if(action==='adoptPreview')return {ok:true,previewId:'verified-preview',rows:[{entryId:7,versionId:2,expectedCurrentId:1,title:'Synthetic budget',before:'Current wording.',after:'Proposed wording.',note:'Shorter.'}]};
    if(action==='adoptConfirm')return {ok:true,adopted:1};
    if(action==='versions')return {ok:true,state:{...state,current_id:current},rows:[{id:2,source:'gpt',title:'Budget',content:'Proposed wording.',created_at:'2026-11-17T12:00:00Z',confirmed:false},{id:1,source:'original',title:'Budget',content:'Current wording.',created_at:'2026-11-16T12:00:00Z',confirmed:true}],hasMore:false};
    if(action==='edit'){current=3;return {ok:true,versionId:3};}return {ok:true,selected:1};
   };
   const main=document.querySelector('.console-main'),wait=()=>new Promise(r=>setTimeout(r,30));
   const click=async(root,key)=>{const btn=[...root.querySelectorAll('button')].find(x=>x.textContent===lang.t(key));if(!btn)throw Error(key);await btn.onclick({currentTarget:btn});await wait();};
   for(const language of ['zh-CN','en']){
    lang.setLang(language);state.want_system=false;state.want_gpt=false;current=1;
    renderCommunicationReferences({main});await wait();
    const flags=main.querySelectorAll('.ro-flag input');checks.push(flags.length===2&&!flags[0].checked&&!flags[1].checked);
    flags[0].checked=true;await flags[0].onchange();checks.push(state.want_system&&!state.want_gpt);
    await click(main,'ro_optimize');checks.push(calls.at(-3)?.[1]!==null);
    const adoptedBefore=calls.filter(x=>x[1].referenceOperation==='adoptConfirm').length;
    await click(main,'ro_review');const review=document.querySelector('.kr-dialog');
    checks.push(review.textContent.includes('Current wording.')&&review.textContent.includes('Proposed wording.')&&calls.filter(x=>x[1].referenceOperation==='adoptConfirm').length===adoptedBefore);
    await click(review,'ro_adopt');const adopted=calls.findLast(x=>x[1].referenceOperation==='adoptConfirm')[1].data;
    checks.push(adopted.previewId==='verified-preview'&&adopted.ids[0]===2);
    await click(main,'ro_versions');const versions=document.querySelector('.kr-dialog');
    await click(versions,'ro_edit_version');const editor=[...document.querySelectorAll('.kr-dialog')].at(-1);
    editor.querySelector('textarea').value='Human revision.';await click(editor,'ro_save_use');
    checks.push(calls.findLast(x=>x[1].referenceOperation==='edit')[1].data.content==='Human revision.');
    versions.querySelector('header button').click();checks.push(document.documentElement.scrollWidth<=innerWidth+2);
    const table=main.querySelector('.kg-table-wrap');checks.push(table.scrollWidth<=table.clientWidth+2);
   }
   return checks;
  })()`);assert.ok(result.every(Boolean),JSON.stringify(result));
  const shot=await b.send('Page.captureScreenshot',{format:'png'});
  require('node:fs').writeFileSync(path.join(__dirname,'../regression/.results/reference-optimization-ipad.png'),Buffer.from(shot.data,'base64'));
 }finally{await b.close();}
});

test('empty scan preview displays bilingual coverage warnings and retries the stored original',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  const checks=await b.evaluate(`(async()=>{
   const {wordImport}=await import('/crm/js/modules/console/manual-docx-import.js'),{data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const checks=[];for(const language of ['zh-CN','en']){
    lang.setLang(language);const root=document.querySelector('.console-main'),results=document.createElement('div'),status=document.createElement('p');root.replaceChildren(results,status);let retried=false;
    data.knowledgeLibrary=async(_ctx,_op,payload)=>{
     if(payload.manualOperation==='recent')return {rows:[{id:'11111111-1111-1111-1111-111111111111',filename:'scan.docx'}]};
     retried=payload.data.retry===true;return {status:'pending',reason:'structure',canRetry:true,coverage:{processed:1,total:1,warnings:[{source:'page2',reason:'image_missing'}],omitted:[{source:'page1',reason:'Heading only',text:'Original heading'}]}};
    };
    const word=wordImport({},results,status,async()=>{});root.append(word.recent);await word.recent.onclick({currentTarget:word.recent});
    const file=results.querySelector('button');await file.onclick({currentTarget:file});
    checks.push(results.textContent.includes(lang.t('dw_warning_image_missing'))&&results.textContent.includes('Original heading'));
    const retry=[...results.querySelectorAll('button')].find(b=>b.textContent===lang.t('dw_retry'));await retry.onclick({currentTarget:retry});checks.push(retried);
   }return checks;
  })()`);assert.ok(checks.every(Boolean),JSON.stringify(checks));
 }finally{await b.close();}
});
