'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {extractPdfText}=require('../../cloudfunctions/person_360/pdf-text');
const {FileImportService,parseInput}=require('../../cloudfunctions/person_360/file-import-service');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/l04-pdf',name));
// Self-authored, uncompressed fixture PDFs; never customer documents.
function pdf(texts=['Fictional Example']){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${texts.map((_,i)=>(4+i*2)+' 0 R').join(' ')}] /Count ${texts.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 texts.forEach((text,i)=>{const content=`BT /F1 ${text.length>1000?'0.001':'12'} Tf 72 720 Td (${text}) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);});
 let out='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const at=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`;
 return Buffer.from(out);
}
test('actual PDF child process: complete text, multipage, malformed, scanned, mixed, encrypted and limits',async()=>{
 assert.equal(await extractPdfText(pdf()),'Fictional Example');
 assert.equal(await extractPdfText(fixture('chinese.pdf')),'系统测试虚构人物职业工程师');
 assert.equal(await extractPdfText(pdf(['First','Second'])),'First\n\nSecond');
 assert.equal((await extractPdfText(pdf(Array(20).fill('Page')))).split('\n\n').length,20);
 for(const [bytes,reason]of [[Buffer.from('x'),'INVALID_CONTENT'],[Buffer.from('%PDF-broken'),'INVALID_CONTENT'],
  [fixture('encrypted.pdf'),'PDF_ENCRYPTED'],[fixture('no-text.pdf'),'PDF_NO_TEXT'],[pdf(['Text','']),'PDF_NO_TEXT'],
  [pdf(Array(21).fill('Page')),'PDF_LIMIT'],[pdf(['X'.repeat(100001)]),'PDF_LIMIT'],[Buffer.alloc(4*1024*1024+1),'INVALID_CONTENT']]){
  await assert.rejects(extractPdfText(bytes),new RegExp(reason));
 }
});
test('process deadline terminates blocked parsing, contains crashes and never inherits credentials',async()=>{
 let terminated=0,options,input;
 class Blocked extends EventEmitter{constructor(){super();this.pid=123;this.exitCode=null;}
  send(bytes){input=bytes;}kill(){terminated++;queueMicrotask(()=>this.emit('exit',null,'SIGKILL'));return true;}}
 const spawn=(file,args,o)=>{options=o;return new Blocked();};
 await assert.rejects(extractPdfText(pdf(),{forkProcess:spawn,timeoutMs:15}),/PDF_TIMEOUT/);
 assert.equal(terminated,1);assert.deepEqual(options.env,{});assert.ok(options.execArgv.includes('--max-old-space-size=64'));
 assert.equal(options.windowsHide,true);assert.equal(input.length,pdf().length);
 await assert.rejects(extractPdfText(pdf(),{forkProcess:(file,args,o)=>{const c=spawn(file,args,o);queueMicrotask(()=>{c.exitCode=3221225477;c.emit('exit',c.exitCode,null);});return c;}}),/PARSE_FAILED/);
});
test('PDF source is server-claimed: failures retain original and skip AI; successful text uses existing draft contract',async()=>{
 const key='00000000-0000-4000-8000-000000000001',calls=[];let bytes=fixture('encrypted.pdf'),aiCalls=0;
 const service=new FileImportService({rpc:async(name,p)=>{
  calls.push(p);if(p.p_operation==='claim')return {leaseToken:key,source:{content_type:'application/pdf',photo_url:'data:application/pdf;base64,'+bytes.toString('base64')}};
  return {job:{status:p.p_operation==='fail'?'failed':'draft',error_code:p.p_data.errorCode||null}};
 },parse:async input=>{aiCalls++;assert.equal(input.action,'parse_import_draft');assert.equal(input.text,'Fictional Example');assert.equal(input.images,undefined);return {parsed:{customer_name:'Fictional Example'}};}});
 const failed=await service.parseDraft(key,'actor');assert.equal(failed.job.error_code,'PDF_ENCRYPTED');assert.equal(aiCalls,0);
 assert.deepEqual(calls.map(x=>x.p_operation),['claim','fail']);
 bytes=pdf();await service.parseDraft(key,'actor');assert.equal(aiCalls,1);assert.equal(calls.at(-1).p_operation,'complete');
 assert.equal(calls.at(-1).p_data.rawText,'Fictional Example');
 assert.equal((await parseInput({content_type:'application/pdf',photo_url:'data:application/pdf;base64,'+pdf().toString('base64')})).text,'Fictional Example');
});
