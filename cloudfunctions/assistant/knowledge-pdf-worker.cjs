'use strict';
const path=require('node:path');
const MAX_PAGES=20,MAX_CHARS=100000;
const respond=value=>{if(process.connected)process.send(value,()=>process.disconnect());};

process.once('message',bytes=>(async()=>{
  globalThis.DOMMatrix=require('@thednp/dommatrix');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const loading=getDocument({data:bytes,verbosity:0,isEvalSupported:false,useSystemFonts:false,useWasm:false,
    disableFontFace:true,stopAtErrors:true,cMapUrl:path.join(assets,'cmaps').replace(/\\/g,'/')+'/',
    cMapPacked:true,standardFontDataUrl:path.join(assets,'standard_fonts').replace(/\\/g,'/')+'/'});
  let passwordRequested=false,result;
  loading.onPassword=()=>{passwordRequested=true;respond({error:'PDF_ENCRYPTED'});};
  try{
    const document=await loading.promise;
    if((await document.getMetadata()).info?.EncryptFilter)throw Error('PDF_ENCRYPTED');
    if(document.numPages>MAX_PAGES)throw Error('PDF_LIMIT');
    const pages=[];let length=0;
    for(let i=1;i<=document.numPages;i++){
      const page=await document.getPage(i),stream=page.streamTextContent({disableNormalization:false});
      const reader=stream.getReader();let text='';
      try{
        for(;;){const {done,value}=await reader.read();if(done)break;
          for(const item of value.items||[]){if(typeof item.str!=='string')continue;
            const part=item.str+(item.hasEOL?'\n':' ');length+=part.length;
            if(length>MAX_CHARS)throw Error('PDF_LIMIT');text+=part;}
        }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();page.cleanup();}
      if(!text.trim())throw Error('PDF_NO_TEXT');
      pages.push(text.trim());length+=2;if(length>MAX_CHARS)throw Error('PDF_LIMIT');
    }
    result={text:pages.join('\n\n')};
  }catch(error){
    result={error:passwordRequested||error.name==='PasswordException'?'PDF_ENCRYPTED':
      ['PDF_LIMIT','PDF_NO_TEXT','PDF_ENCRYPTED'].includes(error.message)?error.message:'INVALID_CONTENT'};
  }finally{await loading.destroy().catch(()=>{});}
  respond(result);
})().catch(()=>respond({error:'INVALID_CONTENT'})));
