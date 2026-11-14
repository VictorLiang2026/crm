'use strict';
const {parsePersonName,PersonService}=require('./person-service');
const fields=['display_name','school','wechat','phone','organization','industry','graduation_year','other_info'];
const personFields=new Set(['display_name','wechat','phone','organization']);
function clean(values) {
 const result={};
 for(const field of fields){
  const value=String(values?.[field]??'').trim();
  if(value.length>(field==='other_info'?8000:field==='display_name'?160:300))throw Error('ROSTER_INVALID');
  result[field]=value;
 }
 if(result.graduation_year&&!/^[1-9]\d{3}$/.test(result.graduation_year))throw Error('ROSTER_YEAR');
 const parsed=parsePersonName(result.display_name);
 result.display_name=parsed.displayName;
 return result;
}
function numberId(v){if(!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw Error('ROSTER_INVALID');return String(v);}
async function activityRoster(actor,op,input,rpc){
 const run=(mode,data)=>rpc('crm_activity_roster_v1',{p_actor:actor,p_op:mode,p_input:data});
 if(['list','history','personHistory','profile'].includes(op))return run(op,input);
 if(op==='confirm')return run(op,{previewId:input.previewId});
 if(!['analyze','prepare'].includes(op))throw Error('ROSTER_INVALID');
 const operation=op==='analyze'?'import':input.operation;
 if(!['import','edit','remove','link','unlink','createPerson'].includes(operation))throw Error('ROSTER_INVALID');
 const rows=input.rows;
 if(!Array.isArray(rows)||rows.length<1||rows.length>1000||(operation!=='import'&&rows.length!==1))throw Error('ROSTER_INVALID');
 const values=rows.map(r=>clean(r.values));
 const keys=[...new Set(values.map(v=>parsePersonName(v.display_name).nameKey))];
 const found=await run('lookup',{keys});
 // PersonService still makes the identity decision. Supply its read adapter from one batched lookup.
 const resolver=new PersonService({request:async(table,method,query)=>{
   if(table==='persons')return found.persons.filter(p=>p.name_key===query.name_key.slice(3)).sort((a,b)=>a.id-b.id).slice(0,Number(query.limit));
   if(table==='customers')return []; // The roster uses Person IDs; no customer conversion is performed.
   throw Error('ROSTER_INVALID');
 }});
 const output=[],plan=[],used=new Set();
 for(let i=0;i<rows.length;i++){
  const r=rows[i],v=values[i],identity=await resolver.resolveName(v.display_name),key=identity.nameKey;
  const profiles=found.profiles.filter(p=>p.name_key===key);
  const candidates=identity.candidates.map(p=>({...p,...found.persons.find(x=>String(x.id)===p.id)}));
  if(op==='analyze'){output.push({number:r.number||i+1,values:v,profiles,candidates,hasMore:identity.hasMore});continue;}
  if(r.choice==='skip')continue;
  let profile=null,person=null;
  if(operation==='import'){
   if(r.choice==='profile')profile=profiles.find(p=>String(p.id)===String(r.id));
   else if(r.choice==='person')person=candidates.find(p=>String(p.id)===String(r.personId))||(identity.hasMore&&found.persons.find(p=>p.name_key===key&&String(p.id)===String(r.personId)));
   else if(!['independent','different'].includes(r.choice))throw Error('ROSTER_IDENTITY');
   if((r.choice==='profile'&&!profile)||(r.choice==='person'&&!person))throw Error('ROSTER_CONFLICT');
   if(r.choice==='different')profile=null;
   else if(person)profile=profiles.find(p=>String(p.person_id)===String(person.id))||null;
  }else{
   profile=await run('profile',{id:numberId(r.id)});
   if(!profile||String(profile.version)!==String(r.version))throw Error('ROSTER_CONFLICT');
   if(operation==='link'){person=candidates.find(p=>String(p.id)===String(r.personId));if(!person)throw Error('ROSTER_IDENTITY');}
   if(operation==='createPerson'&&!identity.canCreate&&!identity.canCreateAfterConfirmation)throw Error('ROSTER_IDENTITY');
  }
  const changes={};
  for(const field of r.updateFields||[]) {
   if(!fields.includes(field)||!profile||field==='display_name'||((profile.person_id||person)&&personFields.has(field)))throw Error('ROSTER_INVALID');
   if(v[field]&&v[field]!==String(profile[field]??''))changes[field]=v[field];
  }
  const signature=profile?'r'+profile.id:person&&person.id!=='different'?'p'+person.id:'n'+v.display_name;
  if(used.has(signature))throw Error('ROSTER_DUPLICATE_ROW');
  used.add(signature);
  plan.push({number:r.number||i+1,name_key:key,values:v,id:profile?.id??null,version:profile?.version??null,personId:r.choice==='different'?null:person?.id??null,
  personVersion:person?.updated_at??null,choice:r.choice==='different'?'independent':r.choice,changes,knownProfiles:profiles.map(p=>String(p.id)),knownPersons:found.persons.filter(p=>p.name_key===key).map(p=>String(p.id))});
 }
 if(op==='analyze')return {rows:output};
 if(!plan.length)throw Error('ROSTER_EMPTY');
 return run('prepare',{activityId:input.activityId||null,operation,file:String(input.file||'').slice(0,250),rows:plan});
}
module.exports={activityRoster};
