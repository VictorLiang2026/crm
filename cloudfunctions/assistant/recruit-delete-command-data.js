/** Server-only public RPC and exact Person-only recruit target reads. */
'use strict';

const ID=/^[1-9][0-9]{0,18}$/;
function validId(value){const s=String(value??'');return ID.test(s)&&Number.isSafeInteger(Number(s));}

function createRecruitDeleteCommandData({env,key,fetchImpl=fetch}={}){
  if(!/^crm-[a-z0-9]+$/.test(env||'')||typeof key!=='string'||!key)
    throw new Error('Recruit delete database is not configured');
  async function request(path,method,filters={},body){
    const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for(const [name,value] of Object.entries(filters))url.searchParams.set(name,String(value));
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${key}`,
        'Accept-Profile':'public','Content-Profile':'public',Accept:'application/json',
        'Content-Type':'application/json',...(method==='POST'?{Prefer:'return=representation'}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if(!response.ok){let pgCode='';try{pgCode=(await response.json()).code||'';}catch(_){}
        const error=new Error('Recruit delete database request failed');
        error.code=pgCode==='40001'?'PREVIEW_STALE':pgCode==='42501'?'COMMAND_DENIED':
          pgCode==='22023'?'INVALID_COMMAND':'RECRUIT_DELETE_FAILED';throw error;}
      const payload=await response.text();return payload?JSON.parse(payload):null;
    }finally{clearTimeout(timer);}
  }
  async function run(stage,actorUid,args={}){
    const value=await request('rpc/assistant_recruit_delete_command_v1','POST',{}, {
      p_stage:stage,p_actor_uid:actorUid,p_command_id:args.commandId||null,
      p_idempotency_key:args.idempotencyKey||null,p_person_id:args.personId||null,
      p_candidate_id:args.candidateId||null,p_request_text:args.requestText||null,
      p_person_mention:args.personMention||null,
      p_preview_hash:args.previewHash||null,
    });
    if(!value||value.ok!==true||!['planned','previewed','confirmed','executed'].includes(value.status))
      throw new Error('Invalid recruit delete command response');
    return value;
  }
  async function listActive(personId,actorUid){
    if(!validId(personId)||typeof actorUid!=='string'||!actorUid.trim())
      throw new Error('Invalid recruit delete target request');
    const person=String(personId);
    const batches=await request('crm_test_batches','GET',{select:'batch_key',
      created_by_uid:`eq.${actorUid}`,limit:'10'});
    if(!Array.isArray(batches))throw new Error('Invalid test-data scope response');
    let targetIds=null;
    if(batches.length){
      const keys=batches.map(row=>row.batch_key).filter(key=>/^crm_test_[a-z0-9_]+$/.test(key||''));
      if(!keys.length)return {rows:[],hasMore:false,trackedPerson:false};
      const personRefs=await request('crm_test_records','GET',{select:'record_id',
        batch_key:`in.(${keys.join(',')})`,record_table:'eq.persons',record_id:`eq.${person}`,limit:'1'});
      if(!Array.isArray(personRefs))throw new Error('Invalid fictional Person scope response');
      if(!personRefs.length)return {rows:[],hasMore:false,trackedPerson:false};
      const refs=await request('crm_test_records','GET',{select:'record_id',
        batch_key:`in.(${keys.join(',')})`,record_table:'eq.recruit_candidates',limit:'100'});
      if(!Array.isArray(refs))throw new Error('Invalid fictional candidate scope response');
      targetIds=refs.map(row=>String(row.record_id)).filter(validId);
      if(!targetIds.length)return {rows:[],hasMore:false,trackedPerson:true};
    }
    const rows=await request('recruit_candidates','GET',{
      select:'id,person_id,customer_id,stage,updated_at,deleted_at',
      person_id:`eq.${person}`,customer_id:'is.null',deleted_at:'is.null',
      ...(targetIds?{id:`in.(${targetIds.join(',')})`}:{}),
      order:'updated_at.desc,id.desc',limit:'51',
    });
    if(!Array.isArray(rows)||rows.length>51||rows.some(row=>
      !validId(row.id)||String(row.person_id)!==person||row.customer_id!==null||row.deleted_at!==null))
      throw new Error('Invalid recruit delete targets');
    return {rows:rows.slice(0,50),hasMore:rows.length>50,trackedPerson:true};
  }
  return {run,listActive};
}
module.exports={createRecruitDeleteCommandData};
