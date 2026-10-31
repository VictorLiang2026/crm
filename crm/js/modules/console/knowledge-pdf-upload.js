export const KNOWLEDGE_PDF_PART_PAGES=40;
export const KNOWLEDGE_PDF_PART_BYTES=30_000_000;

export function knowledgePdfPartName(fileName,index,total,startPage,endPage){
  const clean=String(fileName||'document.pdf');
  const base=clean.replace(/\.pdf$/i,'')||'document';
  const pad=value=>String(value).padStart(3,'0');
  const part=String(index).padStart(2,'0'),count=String(total).padStart(2,'0');
  return `${base}-part${part}-of${count}-pages${pad(startPage)}-${pad(endPage)}.pdf`;
}

export function knowledgePdfPartTitle(title,index,total,startPage,endPage,locale='zh-CN'){
  const marker=locale==='en'
    ? `(Part ${String(index).padStart(2,'0')} of ${String(total).padStart(2,'0')}, pages ${String(startPage).padStart(3,'0')}–${String(endPage).padStart(3,'0')})`
    : `（分卷 ${String(index).padStart(2,'0')}/${String(total).padStart(2,'0')}，第 ${String(startPage).padStart(3,'0')}–${String(endPage).padStart(3,'0')} 页）`;
  return `${String(title||'').trim()} ${marker}`.trim();
}

export async function uploadKnowledgePdfParts(file,{onProgress=()=>{},onPart,locale='zh-CN'}={}){
  if(typeof onPart!=='function')throw new TypeError('onPart callback is required');
  const worker=new Worker(new URL('./knowledge-pdf-upload-worker.js',import.meta.url));
  const sourceBuffer=await file.arrayBuffer();
  return new Promise((resolve,reject)=>{
    let ready=false,finished=false,uploadedParts=0;
    const stop=()=>{if(finished)return;finished=true;worker.terminate();};
    const fail=error=>{
      stop();
      const failure=error instanceof Error?error:new Error(String(error||'PDF_SPLIT_FAILED'));
      failure.uploadedParts=uploadedParts;
      reject(failure);
    };
    worker.onerror=event=>{event.preventDefault();fail(new Error('PDF_SPLIT_FAILED'));};
    worker.onmessage=async({data:message})=>{
      try{
        if(message.type==='fallback'){
          fail(new Error('PDF_PAGE_COUNT_FAILED'));
          return;
        }
        if(message.type==='ready'){
          ready=true;
          if(!message.split){
            if(file.size>KNOWLEDGE_PDF_PART_BYTES){fail(new Error('PDF_PART_TOO_LARGE'));return;}
            stop();
            const result=await onPart(file,{split:false,pageCount:message.pageCount,index:1,total:1,
              startPage:1,endPage:message.pageCount,fileName:file.name,titleSuffix:null});
            resolve({split:false,pageCount:message.pageCount,parts:1,uploadedParts:result===false?0:1});
            return;
          }
          onProgress({stage:'split',pageCount:message.pageCount,total:message.totalParts});
          worker.postMessage({type:'continue'});
          return;
        }
        if(message.type==='part'){
          if(!ready)throw new Error('PDF_SPLIT_FAILED');
          if(message.buffer.byteLength>KNOWLEDGE_PDF_PART_BYTES)
            throw new Error('PDF_PART_TOO_LARGE');
          const index=message.partIndex+1;
          const fileName=knowledgePdfPartName(file.name,index,message.totalParts,message.startPage,message.endPage);
          const part=new File([message.buffer],fileName,{type:'application/pdf',lastModified:file.lastModified});
          const titleSuffix=knowledgePdfPartTitle('',index,message.totalParts,message.startPage,message.endPage,locale).trim();
          onProgress({stage:'upload',index,total:message.totalParts,startPage:message.startPage,endPage:message.endPage});
          const result=await onPart(part,{split:true,pageCount:message.pageCount,index,total:message.totalParts,
            startPage:message.startPage,endPage:message.endPage,fileName,titleSuffix});
          if(result!==false)uploadedParts++;
          worker.postMessage({type:'continue'});
          return;
        }
        if(message.type==='done'){
          stop();resolve({split:true,pageCount:message.pageCount,parts:message.totalParts,uploadedParts});
          return;
        }
        if(message.type==='error')throw new Error(message.code||'PDF_SPLIT_FAILED');
      }catch(error){fail(error);}
    };
    worker.postMessage({type:'start',buffer:sourceBuffer,maxPages:KNOWLEDGE_PDF_PART_PAGES},[sourceBuffer]);
  });
}
