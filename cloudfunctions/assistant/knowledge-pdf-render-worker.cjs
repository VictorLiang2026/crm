'use strict';

const {MAX_PAGES}=require('./knowledge-pdf-limits');
const MAX_IMAGE_BYTES=768*1024,MAX_BATCH=3;
const respond=value=>{if(process.connected)process.send(value,()=>{});};

process.once('message',message=>(async()=>{
  const bytes=Buffer.from(message?.bytes||[]);
  if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('INVALID_CONTENT');
  globalThis.DOMMatrix=require('@thednp/dommatrix');
  const {createCanvas}=require('@napi-rs/canvas');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const path=require('node:path'),assets=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const loading=getDocument({data:new Uint8Array(bytes),verbosity:0,isEvalSupported:false,useSystemFonts:false,useWasm:false,
    disableFontFace:true,stopAtErrors:true,cMapUrl:path.join(assets,'cmaps').replace(/\\/g,'/')+'/',
    cMapPacked:true,standardFontDataUrl:path.join(assets,'standard_fonts').replace(/\\/g,'/')+'/'});
  let passwordRequested=false;
  loading.onPassword=()=>{passwordRequested=true;throw Error('PDF_ENCRYPTED');};
  try{
    const document=await loading.promise;
    if(document.numPages>MAX_PAGES)throw Error('PDF_PAGE_LIMIT');
    const startPage=Number(message?.startPage||1),maxPages=Number(message?.maxPages||MAX_PAGES);
    if(!Number.isSafeInteger(startPage)||startPage<1||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES) throw Error('PDF_PAGE_LIMIT');
    if(startPage>document.numPages){respond({type:'start',pageCount:document.numPages});respond({type:'done',nextPage:startPage});return;}
    respond({type:'start',pageCount:document.numPages});
    const endPage=Math.min(document.numPages,startPage+maxPages-1);
    let batch=[];
    const sendBatch=async()=>{
      if(!batch.length)return;
      const batchId=batch[0].page;
      respond({type:'pages',batchId,pages:batch});
      const acknowledged=await new Promise(resolve=>{
        const listener=message=>{if(message?.ack===batchId){process.off('message',listener);resolve(true);}};
        process.on('message',listener);
      });
      if(!acknowledged)throw Error('PDF_OCR_FAILED');
      batch=[];
    };
    for(let pageNumber=startPage;pageNumber<=endPage;pageNumber++){
      const page=await document.getPage(pageNumber),base=page.getViewport({scale:1});
      const fittedScale=Math.min(1.35,1400/Math.max(base.width,base.height));
      if(!Number.isFinite(fittedScale)||fittedScale<.2||base.width*base.height>100_000_000)throw Error('PDF_RENDER_LIMIT');
      let output=null;
      for(const scale of [fittedScale,fittedScale*.82,fittedScale*.64,fittedScale*.48]){
        const viewport=page.getViewport({scale}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
        const canvasFactory={create:(width,height)=>{const value=createCanvas(width,height);return {canvas:value,context:value.getContext('2d')};},
          reset:(target,width,height)=>{target.canvas.width=width;target.canvas.height=height;target.context=target.canvas.getContext('2d');},
          destroy:target=>{target.canvas.width=0;target.canvas.height=0;target.canvas=null;target.context=null;}};
        await page.render({canvasContext:context,viewport,background:'#ffffff',canvasFactory}).promise;
        for(const quality of [76,62,48]){
          const image=canvas.toBuffer('image/jpeg',quality);
          if(image.length<=MAX_IMAGE_BYTES){output=image;canvas.width=0;canvas.height=0;break;}
        }
        if(output)break;
        canvas.width=0;canvas.height=0;
      }
      page.cleanup();
      if(!output)throw Error('PDF_RENDER_LIMIT');
      batch.push({page:pageNumber,fileName:`page-${pageNumber}.jpg`,contentType:'image/jpeg',base64:output.toString('base64')});
      if(batch.length>=MAX_BATCH||pageNumber===endPage)await sendBatch();
    }
    respond({type:'done',nextPage:endPage+1});
  }catch(error){
    const code=passwordRequested||error.name==='PasswordException'?'PDF_ENCRYPTED':
      ['PDF_PAGE_LIMIT','PDF_RENDER_LIMIT','PDF_OCR_FAILED','INVALID_CONTENT'].includes(error.message)?error.message:'INVALID_CONTENT';
    respond({type:'error',error:code});
  }finally{await loading.destroy().catch(()=>{});if(process.connected)process.disconnect();}
})().catch(error=>respond({type:'error',error:['PDF_PAGE_LIMIT','PDF_RENDER_LIMIT','PDF_OCR_FAILED'].includes(error?.message)?error.message:'INVALID_CONTENT'})));
