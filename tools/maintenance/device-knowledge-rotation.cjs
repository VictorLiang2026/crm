'use strict';
// Called only by the authenticated OCR timer. The database fixes all object names and sizes.
function required(ok,code){if(!ok)throw Error(code);}
function makeWorker({rpc,object,copy,checkLegacyLink}){
 async function head(path){
   const r=await object(path,'HEAD');if(r.status===404)return null;
   required(r.ok,'HEAD_'+r.status);
   const size=r.headers.get('content-length');required(size!==null,'NO_SIZE');
   return {bytes:Number(size),etag:r.headers.get('etag'),checksum:r.headers.get('content-md5')};
 }
 return async function runOne(){
   const row=await rpc('claim');if(!row.source_id)return false;
   const change=(op,error)=>rpc(op,row.source_id,row.lease,error);
   try{
     let old=await head(row.old_key),next=await head(row.new_key);
     if(!next){
       required(row.phase==='copy'&&old?.bytes===Number(row.expected_bytes),'SOURCE_SIZE');
       const r=await copy(row.old_key,row.new_key);required(r.ok,'COPY_'+r.status);await r.body?.cancel();
       next=await head(row.new_key);
     }
     required(next?.bytes===Number(row.expected_bytes),'NEW_SIZE');
     if(old){
       required(old.bytes===next.bytes,'SOURCE_CHANGED');
       if(old.checksum&&next.checksum)required(old.checksum===next.checksum,'CHECKSUM');
     }
     const checkRemoved = old && checkLegacyLink ? await checkLegacyLink(row.old_key) : null;
     if(row.phase==='copy'){required(!!old,'MISSING_ORIGINAL');await change('link');}
     await change('check');
     if(old){const r=await object(row.old_key,'DELETE');required(r.ok||r.status===404,'REMOVE_'+r.status);await r.body?.cancel();}
     required((await head(row.old_key))===null,'OLD_KEY_STILL_EXISTS');
     required((await head(row.new_key))?.bytes===Number(row.expected_bytes),'FINAL_SIZE');
     if(checkRemoved)await checkRemoved();
     await change('done');return true;
   }catch(e){const code=/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'ROTATION_FAILED';await change('fail',code).catch(()=>{});throw Error(code);}
 };
}
let idleUntil=0;
async function runScheduled(){
 if(Date.now()<idleUntil)return;
 const env=process.env.TCB_ENV,key=process.env.CRM_ASSISTANT_DB_API_KEY;
 required(/^crm-[a-z0-9]+$/.test(env||'')&&key,'ROTATION_CONFIG');
 const request=(path,opts)=>fetch('https://'+env+'.api.tcloudbasegateway.com/v1/'+path,{...opts,redirect:'error',signal:AbortSignal.timeout(40000),
   headers:{...opts.headers,Authorization:'Bearer '+key}});
 const run=makeWorker({
   rpc:async(p_op,p_id=null,p_lease=null,p_error=null)=>{
    const r=await request('rdb/rest/rpc/crm_knowledge_path_rotation_v1',{method:'POST',headers:{'Content-Type':'application/json','Content-Profile':'public'},body:JSON.stringify({p_op,p_id,p_lease,p_error})});
    required(r.ok,'ROTATION_RPC_'+r.status);return r.json();
   },
   object:(path,method)=>request('storages/object/knowledge/'+path.split('/').map(encodeURIComponent).join('/'),{method}),
   copy:(sourceKey,destinationKey)=>request('storages/object/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bucketId:'knowledge',sourceKey,destinationKey,copyMetadata:true})}),
   checkLegacyLink:async(path)=>{
     const prefix='https://'+env+'.api.tcloudbasegateway.com';
     const r=await request('storages/object/sign/knowledge/'+path.split('/').map(encodeURIComponent).join('/'),{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
     required(r.ok,'SIGN_'+r.status);const data=await r.json();
     const raw=data.fullSignedURL||data.signedURL;
     required(typeof raw==='string','SIGN_FORMAT');
     const url=new URL(raw.startsWith('/object/')?'/v1/storages'+raw:raw,prefix);
     required(url.origin===prefix,'SIGN_ORIGIN');
     const inspect=()=>fetch(url,{method:'HEAD',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
     const initial=await inspect();
     required(initial.ok,'SIGNED_BEFORE_'+initial.status);
     return async()=>{const final=await inspect();required(final.status===404||final.status===410||final.status===400,'SIGNED_AFTER_'+final.status);};
   }
 });
 const until=Date.now()+45000;
 for(let i=0;i<5&&Date.now()<until;i++){if(!await run()){idleUntil=Date.now()+30000;break;}}
}
module.exports={makeWorker,runScheduled};
