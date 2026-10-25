'use strict';
const {fork}=require('node:child_process');
const path=require('node:path');
const MAX_BYTES=4*1024*1024, TIMEOUT_MS=8000;
const ERRORS=new Set(['PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT','INVALID_CONTENT']);

// A bounded child process contains native parser crashes as well as blocked JavaScript.
// It receives document bytes only, without credentials or client-supplied process options.
function extractPdfText(bytes,{forkProcess=fork,timeoutMs=TIMEOUT_MS}={}) {
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    return Promise.reject(new Error('INVALID_CONTENT'));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const child=forkProcess(path.join(__dirname,'pdf-text-worker.cjs'),[],{
      env:{},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],
      execArgv:['--max-old-space-size=64','--max-semi-space-size=16'],
    });
    const finish=(error,text)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      const complete=()=>error?reject(new Error(error)):resolve(text);
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
    child.once('error',()=>finish('PARSE_FAILED'));
    child.once('exit',(code,signal)=>{if(!settled)finish(signal==='SIGABRT'||code===134?'PDF_LIMIT':'PARSE_FAILED');});
    child.send(new Uint8Array(bytes),error=>{if(error)finish('PARSE_FAILED');});
  });
}
module.exports={extractPdfText};
