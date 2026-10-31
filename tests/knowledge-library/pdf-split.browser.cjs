'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('knowledge upload splits long PDFs into sequential, named, independently reviewable volumes',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try{
    await b.start();await b.openConsole('#/more','authCase=1');
    await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
    await b.evaluate(`(()=>{const script=document.createElement('script');script.src='/crm/js/vendor/pdf-lib-1.17.1.min.js';document.head.append(script)})()`);
    await b.wait('!!window.PDFLib');
    const workerResult=await b.evaluate(`(async()=>{
      const {uploadKnowledgePdfParts}=await import('/crm/js/modules/console/knowledge-pdf-upload.js');
      const {PDFDocument}=window.PDFLib;const source=await PDFDocument.create();
      for(let i=0;i<141;i++)source.addPage();
      const blob=await source.save();const file=new File([blob],'Policy.pdf',{type:'application/pdf'}),parts=[];
      const result=await uploadKnowledgePdfParts(file,{onPart:async(part,info)=>{
        const parsed=await PDFDocument.load(await part.arrayBuffer());
        parts.push({name:part.name,pages:parsed.getPageCount(),start:info.startPage,end:info.endPage,index:info.index,total:info.total});
      }});
      return {result,parts};
    })()`);
    assert.deepEqual(workerResult.result,{split:true,pageCount:141,parts:4,uploadedParts:4});
    assert.deepEqual(workerResult.parts.map(({name,pages,start,end})=>({name,pages,start,end})),[
      {name:'Policy-part01-of04-pages001-040.pdf',pages:40,start:1,end:40},
      {name:'Policy-part02-of04-pages041-080.pdf',pages:40,start:41,end:80},
      {name:'Policy-part03-of04-pages081-120.pdf',pages:40,start:81,end:120},
      {name:'Policy-part04-of04-pages121-141.pdf',pages:21,start:121,end:141},
    ]);
    const boundary=await b.evaluate(`(async()=>{
      const {uploadKnowledgePdfParts}=await import('/crm/js/modules/console/knowledge-pdf-upload.js');
      const source=await PDFLib.PDFDocument.create();for(let i=0;i<40;i++)source.addPage();
      const file=new File([await source.save()],'Boundary.pdf',{type:'application/pdf'}),seen=[];
      const result=await uploadKnowledgePdfParts(file,{onPart:async(part,info)=>seen.push({name:part.name,split:info.split})});
      let rejected=false,uploads=0;
      try{await uploadKnowledgePdfParts(new File(['invalid'],'broken.pdf',{type:'application/pdf'}),{onPart:async()=>{uploads++;}});}
      catch(error){rejected=error.message==='PDF_PAGE_COUNT_FAILED';}
      return {result,seen,rejected,uploads};
    })()`);
    assert.deepEqual(boundary.result,{split:false,pageCount:40,parts:1,uploadedParts:1});
    assert.deepEqual(boundary.seen,[{name:'Boundary.pdf',split:false}]);
    assert.equal(boundary.rejected,true,'unreadable PDFs fail before any server upload');
    assert.equal(boundary.uploads,0);
    const ui=await b.evaluate(`(async()=>{
      const {renderKnowledgeEditor}=await import('/crm/js/modules/console/knowledge-pages.js');
      const {setLang,t}=await import('/crm/js/modules/console/i18n.js');
      const calls=[],uploads=[],toasts=[];
      const ctx={main:document.querySelector('.console-main'),toast:(...args)=>toasts.push(args),
        api:{call:async(name,payload)=>{calls.push({name,payload});
          if(payload.operation==='uploadPrepare')return {ok:true,sourceId:calls.length,uploadId:'u'+calls.length,storageKey:'k'+calls.length,contentType:'application/pdf'};
          if(payload.operation==='uploadFinalize')return {ok:true,queued:true};
          if(payload.operation==='uploadCancel')return {ok:true};
          throw new Error('unexpected operation '+payload.operation);
        }},knowledgeFiles:{upload:async(key,file)=>{uploads.push({key,name:file.name,size:file.size});return {ok:true};}}};
      setLang('zh-CN');renderKnowledgeEditor(ctx,{mode:'upload'});
      const form=document.querySelector('.kg-page-form');form.elements.title.value='产品政策';
      form.querySelector('input[name="categories"][value="other"]').checked=true;
      const source=await PDFLib.PDFDocument.create();for(let i=0;i<41;i++)source.addPage();
      const blob=await source.save(),file=new File([blob],'Original.pdf',{type:'application/pdf'});
      const transfer=new DataTransfer();transfer.items.add(file);form.elements.file.files=transfer.files;
      form.requestSubmit();
      while(location.hash!=='#/knowledge-governance')await new Promise(resolve=>setTimeout(resolve,20));
      return {calls,uploads,toasts,help:form.querySelector('.foot-note')?.textContent,
        titles:calls.filter(x=>x.payload.operation==='uploadPrepare').map(x=>x.payload.data.title),
        names:calls.filter(x=>x.payload.operation==='uploadPrepare').map(x=>x.payload.data.fileName),
        enHelp:(setLang('en'),t('kg_source_upload_help')),
        enMarker:(await import('/crm/js/modules/console/knowledge-pdf-upload.js')).knowledgePdfPartTitle('Policy',1,2,1,40,'en')};
    })()`);
    const operations=ui.calls.map(entry=>entry.payload.operation);
    assert.deepEqual(operations,['uploadPrepare','uploadFinalize','uploadPrepare','uploadFinalize']);
    assert.deepEqual(ui.uploads.map(item=>item.name),['Original-part01-of02-pages001-040.pdf','Original-part02-of02-pages041-041.pdf']);
    assert.deepEqual(ui.names,ui.uploads.map(item=>item.name));
    assert.match(ui.titles[0],/分卷 01\/02，第 001–040 页/);
    assert.match(ui.titles[1],/分卷 02\/02，第 041–041 页/);
    assert.match(ui.enHelp,/up to 40 pages/);
    assert.equal(ui.enMarker,'Policy (Part 01 of 02, pages 001–040)');
    await b.healthy();
  }finally{await b.close();}
});
