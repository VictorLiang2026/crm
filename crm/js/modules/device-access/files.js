const PART=393216;
const to64=async blob=>{const b=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
export function deviceFiles(call,bucket){
 const run=async(op,fields)=>{const r=await call('person_360',{action:'deviceAttachment',op,bucket,...fields});if(!r||r.error)throw Error(typeof r?.error==='string'?r.error:'STORAGE_FAILED');return r;};
 return {
 async upload(path,file,options={}){
 const {id}=await run('begin',{path,bytes:file.size,type:options.contentType||file.type});if(!id)throw Error('STORAGE_FAILED');
 try{for(let start=0;start<file.size;start+=PART)await run('part',{id,i:start/PART,part:await to64(file.slice(start,start+PART))});
 return {data:await run('finish',{id})};
 }catch(err){await run('abort',{id}).catch(()=>{});throw err;}
 },
 async remove(paths){for(const path of paths)await run('remove',{path});return {data:true};},
 async createSignedUrl(path){
 const chunks=[];let total,type;
 for(let offset=0;total===undefined||offset<total;offset+=PART){
 const r=await run('download',{path,offset});if(!Number.isSafeInteger(r.total)||r.total<=0||r.total>100000000||(total!==undefined&&total!==r.total))throw Error('STORAGE_FAILED');total=r.total;type=r.type;
 const bytes=Uint8Array.from(atob(r.part),c=>c.charCodeAt(0));if(bytes.length!==Math.min(PART,total-offset))throw Error('STORAGE_FAILED');chunks.push(bytes);}
 const url=URL.createObjectURL(new Blob(chunks,{type}));setTimeout(()=>URL.revokeObjectURL(url),60000);return {data:{url}};
 }};
}
