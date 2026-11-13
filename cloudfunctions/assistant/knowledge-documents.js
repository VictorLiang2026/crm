'use strict';
const {createHash}=require('node:crypto');
const {volumeNumber}=require('./knowledge-content');
const blockSize=393216;
function invalid(code='INVALID_DOCUMENT'){throw Object.assign(new Error(code),{code});}
function positive(n){return Number.isSafeInteger(n)&&n>0;}
function checkedVolume(input,doc){
  if(!doc?.original_ready||!positive(input?.index)||input.index>doc.part_count||
    input.start!==1+(input.index-1)*30||input.end!==Math.min(input.index*30,doc.page_count))invalid();
  return {documentId:doc.id,index:input.index,start:input.start,end:input.end};
}
function documentService(request,rpc,generateSummary){
  async function parent(actor,id){
    if(!positive(Number(id)))invalid();
    const [doc]=await request('knowledge_documents','GET',{select:'*',id:'eq.'+id,owner_uid:'eq.'+actor,limit:1});
    if(!doc||!doc.part_count)invalid('DOCUMENT_UNAVAILABLE');
    return doc;
  }
  async function begin(actor,d){
    if(!/^[a-f0-9]{64}$/.test(d.sha256)||!positive(d.size)||d.size>100000000||!positive(d.pages)||d.pages<=30||
       typeof d.name!=='string'||!d.name.toLowerCase().endsWith('.pdf')||d.name.length>255||
       typeof d.title!=='string'||!d.title.trim()||d.title.length>500)invalid();
    const key=actor+':'+d.sha256;
    const lookup=async()=>(await request('knowledge_documents','GET',{select:'id,page_count,original_size,original_ready',document_key:'eq.'+key,limit:1}))[0];
    let doc=await lookup();
    if(!doc){try{[doc]=await request('knowledge_documents','POST',{select:'id,page_count,original_size,original_ready'},[{
      document_key:key,owner_uid:actor,title:d.title.trim(),original_name:d.name,original_sha256:d.sha256,
      original_size:d.size,page_count:d.pages,part_count:Math.ceil(d.pages/30)}]);}
      catch(err){if(err.code!=='DUPLICATE_SOURCE')throw err;doc=await lookup();}}
    if(!doc||doc.page_count!==d.pages||doc.original_size!==d.size)invalid('DOCUMENT_CONFLICT');
    return {ok:true,documentId:doc.id,ready:doc.original_ready};
  }
  async function saveChunk(doc,d){
    const count=Math.ceil(doc.original_size/blockSize);
    if(!Number.isInteger(d.part)||d.part<0||d.part>=count||typeof d.data!=='string'||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(d.data)||d.data.length!==4*Math.ceil(Math.min(blockSize,doc.original_size-blockSize*d.part)/3))invalid();
    if(doc.original_ready)return {ok:true};
    try{await request('knowledge_document_chunks','POST',{select:'part'},[{document_id:doc.id,part:d.part,data:d.data}]);}
    catch(err){if(err.code!=='DUPLICATE_SOURCE')throw err;
      const [found]=await request('knowledge_document_chunks','GET',{select:'data',document_id:'eq.'+doc.id,part:'eq.'+d.part,limit:1});
      if(found?.data!==d.data)invalid('DOCUMENT_CONFLICT');}
    return {ok:true};
  }
  async function complete(doc){
    if(!doc.original_ready){
      const hash=createHash('sha256');let bytes=0;
      const count=Math.ceil(doc.original_size/blockSize);
      for(let offset=0;offset<count;offset+=4){
        const rows=await request('knowledge_document_chunks','GET',{select:'part,data',document_id:'eq.'+doc.id,order:'part.asc',offset,limit:4});
        if(rows.length!==Math.min(4,count-offset))invalid('UPLOAD_INCOMPLETE');
        for(const [j,r] of rows.entries()){
          if(r.part!==offset+j)invalid('UPLOAD_INCOMPLETE');
          const buf=Buffer.from(r.data,'base64');if(!r.part&&buf.subarray(0,5).toString()!=='%PDF-')invalid();
          bytes+=buf.length;hash.update(buf);
        }
      }
      if(bytes!==doc.original_size||hash.digest('hex')!==doc.original_sha256)invalid('DOCUMENT_CONFLICT');
      await request('knowledge_documents','PATCH',{id:'eq.'+doc.id},{original_ready:true});
    }
    return {ok:true};
  }
  async function run(op,d,actor){
    if(op==='documentBegin')return begin(actor,d);
    const doc=await parent(actor,d.id);
    if(op==='documentChunk')return saveChunk(doc,d);
    if(op==='documentComplete')return complete(doc);
    if(op==='documentOriginal'){
      if(!doc.original_ready||!Number.isInteger(d.part)||d.part<0||d.part>=Math.ceil(doc.original_size/blockSize))invalid();
      const [row]=await request('knowledge_document_chunks','GET',{select:'data',document_id:'eq.'+doc.id,part:'eq.'+d.part,limit:1});
      if(!row)invalid('DOCUMENT_UNAVAILABLE');return {data:row.data,total:doc.original_size,name:doc.original_name};
    }
    const read=async()=>{const r=await rpc('crm_knowledge_document_read_v1',{p_document:doc.id});if(r.error||!r.data)invalid('DOCUMENT_UNAVAILABLE');return r.data;};
    if(op==='documentOverview')return read();
    if(op==='documentDraft'){
      const overview=await read();
      if(!overview.parts.length||d.basis!==overview.basis)invalid('DOCUMENT_CONFLICT');
      const sections=overview.parts.map(p=>'['+volumeNumber(doc.id,p.part)+' pp. '+p.start+'–'+p.end+'] '+p.summary);
      const summarize=async list=>(await generateSummary({domain:'other',title:doc.title,content:list.join('\n\n')},actor)).summary;
      let batch=[],partial=[],length=0;
      for(const section of sections){
        if(batch.length&&length+section.length>12000){partial.push(await summarize(batch));batch=[];length=0;}
        batch.push(section);length+=section.length;
      }
      if(partial.length){partial.push(await summarize(batch));batch=partial;}
      const summary=await summarize(batch);
      if((await read()).basis!==overview.basis)invalid('DOCUMENT_CONFLICT');
      return {summary,basis:overview.basis};
    }
    if(op==='documentGpt'){
      const overview=await read();
      if(!overview.parts.length||d.basis!==overview.basis||d.version!==overview.gptVersion||typeof d.summary!=='string'||!d.summary.trim()||d.summary.length>12000)invalid('DOCUMENT_CONFLICT');
      const saved=await request('knowledge_documents','PATCH',{id:'eq.'+doc.id,gpt_version:'eq.'+overview.gptVersion,select:'id'},{gpt_summary:d.summary.trim(),gpt_basis:d.basis,gpt_version:overview.gptVersion+1});
      if(saved.length!==1)invalid('DOCUMENT_CONFLICT');return read();
    }
    invalid();
  }
  return {run,parent};
}
module.exports={documentService,checkedVolume};
