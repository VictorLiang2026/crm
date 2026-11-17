'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('iPad bilingual scan preview shows coverage warnings and permits a retryable original',async()=>{
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
