'use strict';

const {fork}=require('node:child_process');
const path=require('node:path');
const MAX_BYTES=16*1024*1024;
const TIMEOUT_MS=20000;
const ERRORS=new Set(['PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT','INVALID_CONTENT']);

function extractPdfText(bytes,{forkProcess=fork,timeoutMs=TIMEOUT_MS}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    return Promise.reject(Object.assign(new Error('INVALID_CONTENT'),{code:'INVALID_CONTENT'}));
  if(bytes.length>MAX_BYTES)
    return Promise.reject(Object.assign(new Error('PDF_LIMIT'),{code:'PDF_LIMIT'}));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const child=forkProcess(path.join(__dirname,'knowledge-pdf-worker.cjs'),[],{
      env:{},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],
      execArgv:['--max-old-space-size=96','--max-semi-space-size=16'],
    });
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      const complete=()=>error?reject(Object.assign(new Error(error),{code:error})):resolve(value);
      if(child.exitCode!==null||child.signalCode||!child.pid){complete();return;}
      child.once('exit',complete);
      try{if(!child.kill('SIGKILL')){child.removeListener('exit',complete);complete();}}
      catch{child.removeListener('exit',complete);complete();}
    };
    const timer=setTimeout(()=>finish('PDF_TIMEOUT'),timeoutMs);
    child.once('message',message=>{
      if(message?.error)return finish(ERRORS.has(message.error)?message.error:'INVALID_CONTENT');
      if(typeof message?.text!=='string'||!message.text.trim()||message.text.length>100000)
        return finish('INVALID_CONTENT');
      finish(null,message.text);
    });
    child.once('error',()=>finish('INVALID_CONTENT'));
    child.once('exit',(code,signal)=>{if(!settled)finish(signal==='SIGABRT'||code===134?'PDF_LIMIT':'INVALID_CONTENT');});
    child.send(new Uint8Array(bytes),error=>{if(error)finish('INVALID_CONTENT');});
  });
}

module.exports={extractPdfText,MAX_BYTES,TIMEOUT_MS};
