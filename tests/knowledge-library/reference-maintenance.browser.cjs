'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('iPad bilingual communication table has five columns with version selection and enabled filtering',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  const result=await b.evaluate(`(async()=>{
   const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js');
   const {data}=await import('/crm/js/modules/console/data.js'),lang=await import('/crm/js/modules/console/i18n.js');
   const calls=[],records=[{id:1,scenario:'Budget reference',response_logic:'Check budget and respect refusal.',lifecycle_status:'verified',updated_at:'v1',metadata:{kind:'objection',keywords:['budget'],enabled:true}},
    {id:2,scenario:'Disabled reference',response_logic:'Never selected.',metadata:{kind:'wording',enabled:false}}];
   data.knowledgeLibrary=async(_ctx,op,payload)=>{
    calls.push([op,payload]);
    if(op==='referenceOptimization'&&payload.referenceOperation==='states')return {ok:true,rows:[]};
    if(op==='manualDocx'){
     if(payload.manualOperation==='stage')return {id:'synthetic'};
     if(payload.manualOperation==='preview')return {status:'ready',mode:'structured',previewId:'verified',uncovered:0,rows:[
      {action:'new',entry:{kind:'wording',title:'New topic',origin:'fixture.docx',content:'New text'},matches:[]},
      {action:'ambiguous',entry:{kind:'wording',title:'Revised topic',origin:'fixture.docx',content:'Revised text'},matches:[{id:'7',title:'Existing topic',content:'Old text'}]}
     ]};
     if(payload.manualOperation==='confirm')return {added:1,revised:1};
    }
    if(payload.referenceOperation==='importPreview')return {ok:true,count:payload.data.entries.length,previewToken:'synthetic-preview'};
    if(payload.referenceOperation==='importConfirm')return {ok:true,added:1,skipped:0};
    return {ok:true,rows:records};
   };
   const main=document.querySelector('.console-main'),checks=[];
   for(const code of ['zh-CN','en']){
    lang.setLang(code);renderCommunicationReferences({main,toast(){}});await new Promise(r=>setTimeout(r,25));
    checks.push(main.querySelectorAll('thead th').length===5&&main.querySelectorAll('tbody tr').length===1&&main.querySelector('thead').textContent.includes(lang.t('ro_selector_heading')));
    const selects=main.querySelectorAll('select');selects[1].value='disabled';selects[1].dispatchEvent(new Event('change'));
    checks.push(main.querySelector('tbody').textContent.includes('Disabled reference')&&!main.querySelector('tbody').textContent.includes('Budget reference'));
    checks.push(document.documentElement.scrollWidth<=innerWidth+2);
    const count=()=>calls.filter(c=>c[1].referenceOperation==='importConfirm').length;
    const before=count();
    [...main.querySelectorAll('button')].find(b=>b.textContent===lang.t('kr_import')).click();
    const dialog=document.querySelector('.kr-dialog'),picker=dialog.querySelector('input[type=file]');
    const upload=new DataTransfer();
    upload.items.add(new File([JSON.stringify([{entryKey:'TEST-1',title:'Synthetic heading',content:'Synthetic preview text'}])],'fixture.json',{type:'application/json'}));
    picker.files=upload.files;await picker.onchange();
    checks.push(count()===before&&dialog.querySelector('pre')?.textContent==='Synthetic preview text');
    const confirm=[...dialog.querySelectorAll('button')].find(b=>b.textContent===lang.t('kr_import_confirm'));
    await confirm.onclick({currentTarget:confirm});
    checks.push(count()===before+1&&!dialog.contains(confirm));
    const wordFile=new DataTransfer();
    wordFile.items.add(new File(['synthetic bytes'],'fixture.docx'));
    picker.files=wordFile.files;await picker.onchange();
    const selectors=dialog.querySelectorAll('select');
    checks.push(picker.accept.includes('.docx')&&selectors.length===2&&selectors[1].value===''&&dialog.textContent.includes('Old text'));
    selectors[1].value='7';selectors[1].onchange();
    const apply=[...dialog.querySelectorAll('button')].find(b=>b.textContent===lang.t('dw_confirm'));
    const originalConfirm=window.confirm;let human=false;
    try{
     window.confirm=()=>human;
     const prior=calls.filter(c=>c[1].manualOperation==='confirm').length;
     await apply.onclick({currentTarget:apply});
     checks.push(calls.filter(c=>c[1].manualOperation==='confirm').length===prior);
     human=true;await apply.onclick({currentTarget:apply});
     const latest=calls.filter(c=>c[1].manualOperation==='confirm').at(-1)[1].data;
     checks.push(latest.previewId==='verified'&&latest.choices.length===2&&latest.choices[1].target==='7');
    }finally{window.confirm=originalConfirm;}
    dialog.querySelector('header button').click();
   }
   return {checks,writes:calls.filter(c=>c[0]!=='manualDocx'&&!['list','states','importPreview','importConfirm'].includes(c[1]?.referenceOperation)).length};
  })()`);
  assert.ok(result.checks.every(Boolean),JSON.stringify(result));assert.equal(result.writes,0);
 }finally{await b.close();}
});
