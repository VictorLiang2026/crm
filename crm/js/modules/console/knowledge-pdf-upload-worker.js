importScripts('/crm/js/vendor/pdf-lib-1.17.1.min.js');

let sourceDocument=null,pageCount=0,maxPages=40,totalParts=0,nextPart=0;
const send=(message,transfer=[])=>self.postMessage(message,transfer);

self.onmessage=async({data:message})=>{
  try{
    if(message.type==='start'){
      maxPages=Math.max(1,Math.floor(Number(message.maxPages)||40));
      try{
        sourceDocument=await PDFLib.PDFDocument.load(new Uint8Array(message.buffer));
        pageCount=sourceDocument.getPageCount();
        if(!pageCount)throw new Error('empty PDF');
      }catch(_){send({type:'fallback'});return;}
      totalParts=Math.ceil(pageCount/maxPages);
      send({type:'ready',pageCount,totalParts,split:pageCount>maxPages});
      return;
    }
    if(message.type==='continue'&&sourceDocument){
      if(nextPart>=totalParts){send({type:'done',pageCount,totalParts});sourceDocument=null;return;}
      const partIndex=nextPart++,startIndex=partIndex*maxPages;
      const endIndex=Math.min(startIndex+maxPages,pageCount),indices=Array.from({length:endIndex-startIndex},(_,index)=>startIndex+index);
      const output=await PDFLib.PDFDocument.create();
      const copied=await output.copyPages(sourceDocument,indices);
      for(const page of copied)output.addPage(page);
      const bytes=await output.save();
      const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      send({type:'part',pageCount,partIndex,totalParts,startPage:startIndex+1,endPage:endIndex,buffer},[buffer]);
      return;
    }
  }catch(_){send({type:'error',code:'PDF_SPLIT_FAILED'});}
};
