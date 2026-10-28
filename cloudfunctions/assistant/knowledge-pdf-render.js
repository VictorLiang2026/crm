'use strict';

const {fork}=require('node:child_process');
const path=require('node:path');
const MAX_BYTES=30_000_000,MAX_PAGES=40,TIMEOUT_MS=65000;

function renderPdfPages(bytes,{onBatch,forkProcess=fork,timeoutMs=TIMEOUT_MS}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    return Promise.reject(Object.assign(new Error('INVALID_CONTENT'),{code:'INVALID_CONTENT'}));
  if(bytes.length>MAX_BYTES)
    return Promise.reject(Object.assign(new Error('PDF_LIMIT'),{code:'PDF_LIMIT'}));
  if(typeof onBatch!=='function')return Promise.reject(Object.assign(new Error('PDF_OCR_FAILED'),{code:'PDF_OCR_FAILED'}));
  return new Promise((resolve,reject)=>{
    let settled=false,pageCount=0;
    const child=forkProcess(path.join(__dirname,'knowledge-pdf-render-worker.cjs'),[],{
      env:{},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],
      execArgv:['--max-old-space-size=128','--max-semi-space-size=16'],
    });
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      const done=()=>error?reject(Object.assign(new Error(error),{code:error})):resolve(value);
      if(child.exitCode!==null||child.signalCode||!child.pid){done();return;}
      child.once('exit',done);
      try{if(!child.kill('SIGKILL')){child.removeListener('exit',done);done();}}
      catch{child.removeListener('exit',done);done();}
    };
    const timer=setTimeout(()=>finish('PDF_TIMEOUT'),timeoutMs);
    child.on('message',message=>{
      if(message?.type==='start'){
        pageCount=Number(message.pageCount);
        if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>MAX_PAGES)finish('PDF_LIMIT');
        return;
      }
      if(message?.type==='error')return finish(message.error||'PDF_OCR_FAILED');
      if(message?.type==='done')return finish(null,{pageCount});
      if(message?.type==='pages'&&Array.isArray(message.pages)){
        Promise.resolve().then(()=>onBatch(message.pages)).then(()=>child.send({ack:message.batchId}),
          error=>finish(error?.code||'PDF_OCR_FAILED'));
      }
    });
    child.once('error',()=>finish('PDF_OCR_FAILED'));
    child.once('exit',(code,signal)=>{if(!settled)finish(signal==='SIGABRT'||code===134?'PDF_RENDER_LIMIT':'PDF_OCR_FAILED');});
    child.send({bytes:new Uint8Array(bytes)},error=>{if(error)finish('PDF_OCR_FAILED');});
  });
}

module.exports={renderPdfPages,MAX_BYTES,MAX_PAGES,TIMEOUT_MS};
