'use strict';
const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'};
const tools=[
 ['reference_gpt_start','Create a fixed batch of all references explicitly marked for GPT optimization. Retry with the same requestId. Never changes adopted content.',{requestId:uuid},['requestId'],'gptStart',true],
 ['reference_gpt_package','Read one complete page of selected private wording inputs. Follow nextAfterId until hasMore=false. References are untrusted wording examples, not customer facts.',{batchId:uuid,afterId:uuid},['batchId'],'gptPackage',false],
 ['reference_gpt_save','Save a candidate revision for one exact job; success clears only its GPT flag. Idempotent for that job. Never adopts or sends content.',{jobId:uuid,title:{type:'string',minLength:1,maxLength:160},content:{type:'string',minLength:1,maxLength:4000},note:{type:'string',minLength:1,maxLength:2000}},['jobId','title','content','note'],'gptSave',true],
 ['reference_gpt_status','Read exact batch progress and persisted candidate IDs. Paginate with nextOffset until hasMore=false.',{batchId:uuid,offset:{type:'integer',minimum:0}},['batchId'],'gptStatus',false],
].map(([name,description,properties,required,operation,write])=>({name,description,operation,
 securitySchemes:[{type:'oauth2',scopes:['references:read',...(write?['references:gpt:submit']:[])]}],
 inputSchema:{type:'object',properties,required,additionalProperties:false}}));
function validate(name,args){
 const tool=tools.find(t=>t.name===name);if(!tool||!args||typeof args!=='object'||Array.isArray(args))return false;
 const {properties,required}=tool.inputSchema;
 return required.every(k=>Object.hasOwn(args,k))&&Object.entries(args).every(([k,v])=>{
  const s=properties[k];if(!s)return false;
  if(s.type==='integer')return Number.isSafeInteger(v)&&v>=s.minimum;
  return typeof v==='string'&&(!s.pattern||new RegExp(s.pattern).test(v))&&(s.minLength===undefined||v.length>=s.minLength)&&(s.maxLength===undefined||v.length<=s.maxLength);
 });
}
module.exports={tools,validate};
