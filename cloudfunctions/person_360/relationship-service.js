'use strict';

const { PersonService } = require('./person-service');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['family','friend','colleague','business','referral','other']);
const one = rows => Array.isArray(rows) ? rows[0] || null : null;
function idOf(value) {
  const id=String(value ?? '');
  if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id))) throw new Error('Invalid Person ID');
  return id;
}

class RelationshipService {
  constructor({request,rpc}) {
    if(typeof request!=='function'||typeof rpc!=='function') throw new Error('Authorized relationship database adapters are required');
    this.request=request; this.rpc=rpc;
  }
  resolveName(name) { return new PersonService({request:this.request}).resolveName(name); }
  async listForPerson(personId,{includeDeleted=false}={}) {
    const pid=idOf(personId);
    const person=one(await this.request('persons','GET',{select:'id',id:`eq.${pid}`,deleted_at:'is.null',limit:1}));
    if(!person) throw new Error('Person not found');
    const rows=await this.request('relationships','GET',{
      select:'id,from_person_id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,source,status,confirmed_at,confirmed_by_uid,importance,last_meaningful_interaction_at,created_at,updated_at,deleted_at',
      or:`(from_person_id.eq.${pid},to_person_id.eq.${pid})`,
      ...(includeDeleted?{}:{deleted_at:'is.null'}),order:'updated_at.desc,id.desc',limit:100,
    });
    const otherIds=[...new Set((rows||[]).map(r=>String(r.from_person_id)===pid?r.to_person_id:r.from_person_id).map(String))];
    const people=otherIds.length?await this.request('persons','GET',{select:'id,display_name',id:`in.(${otherIds.join(',')})`,limit:100}):[];
    const names=new Map((people||[]).map(p=>[String(p.id),p.display_name]));
    return {personId:pid,rows:(rows||[]).map(r=>({...r,direction:String(r.from_person_id)===pid?'outgoing':'incoming',
      other_person_id:String(r.from_person_id)===pid?r.to_person_id:r.from_person_id,
      other_name:names.get(String(String(r.from_person_id)===pid?r.to_person_id:r.from_person_id))||null}))};
  }
  async preview(personId,operation,payload,actorUid) {
    const pid=idOf(personId);
    if(!actorUid||!UUID.test(String(payload?.idempotencyKey||''))||!['create','update','confirm','unlink','restore'].includes(operation)||
       !payload||typeof payload!=='object'||Array.isArray(payload)) throw new Error('Invalid relationship review command');
    const data={...payload}; delete data.idempotencyKey;
    if(operation==='create') {
      const otherId=idOf(data.otherPersonId);
      if(otherId===pid||typeof data.otherName!=='string'||!TYPES.has(data.relationshipType)) throw new Error('Invalid relationship Person selection');
      const identity=await this.resolveName(data.otherName);
      const selected=(identity.candidates||[]).find(candidate=>String(candidate.id)===otherId);
      if(!selected) throw new Error('Selected Person is not in the current identity results; resolve again');
      data.otherName=selected.displayName;
      data.fromPersonId=data.direction==='incoming'?Number(otherId):Number(pid);
      data.toPersonId=data.direction==='incoming'?Number(pid):Number(otherId);
      delete data.direction; delete data.otherPersonId;
      if(data.importance!==null&&data.importance!==undefined&&(!Number.isInteger(Number(data.importance))||Number(data.importance)<1||Number(data.importance)>5)) throw new Error('Invalid relationship importance');
    } else {
      data.relationshipId=idOf(data.relationshipId);
      delete data.otherName;
    }
    const result=await this.rpc('crm_relationship_preview_v1',{p_actor_uid:actorUid,p_idempotency_key:payload.idempotencyKey,
      p_person_id:Number(pid),p_operation:operation,p_payload:data});
    const response=one(result)||result;
    const preview=response.preview||{};
    const endpointIds=[...new Set([preview.fromPersonId,preview.toPersonId].filter(Boolean).map(idOf))];
    const people=endpointIds.length?await this.request('persons','GET',{select:'id,display_name',id:`in.(${endpointIds.join(',')})`,deleted_at:'is.null',limit:2}):[];
    const names=new Map((people||[]).map(person=>[String(person.id),person.display_name]));
    response.preview={...preview,fromPersonName:names.get(String(preview.fromPersonId))||null,
      toPersonName:names.get(String(preview.toPersonId))||null,
      selectedPersonName:operation==='create'?data.otherName||null:undefined};
    return response;
  }
  async execute(previewId,actorUid) {
    if(!actorUid||!UUID.test(String(previewId||''))) throw new Error('Invalid relationship preview');
    const result=await this.rpc('crm_relationship_execute_v1',{p_actor_uid:actorUid,p_preview_id:previewId});
    return one(result)||result;
  }
}
module.exports={RelationshipService,TYPES};
