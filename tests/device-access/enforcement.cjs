'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const {PGlite}=require(process.env.CRM_PGLITE_MODULE||'@electric-sql/pglite');
const {canonical,digest,deviceMessage}=require('../../cloudfunctions/_shared/device-proof');
const {protect,internalCall}=require('../../cloudfunctions/assistant/device-runtime');
const {makeHandler}=require('../../cloudfunctions/person_360/device-attachment');
(async()=>{
 const db=new PGlite(),uid='synthetic-member',env=process.env.TCB_ENV='crm-testdevice',q=(sql,args)=>db.query(sql,args);
 process.env.CRM_PERSON360_DB_API_KEY='isolated-service-key';
 const mig=name=>fs.readFileSync('cloudbase/migrations/'+name+'.sql','utf8');
 try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
 for(const name of ['20261109194000_device_registry','20261110081000_device_member_gateway','20261110153000_device_delegation','20261110153100_device_file_parts'])await db.exec(mig(name));
 await q('INSERT INTO public.crm_access_members(uid) VALUES($1)',[uid]);
 async function rpc(name,args,overrides){
 const stage=name==='crm_device_file_stage_v1',role=overrides?.role||(stage?'service_role':'anon'),claims=overrides?.claims||{role};
 assert(['anon','authenticated','service_role'].includes(role));await q('BEGIN');
 try{await q('SET LOCAL ROLE '+role);await q("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
 let stmt,values;if(stage){stmt='public.crm_device_file_stage_v1($1,$2,$3,$4::jsonb)';values=[args.p_op,args.p_actor,args.p_fp,args.p];}
 else if(name==='crm_device_delegate_v1'){stmt='public.crm_device_delegate_v1($1,$2::jsonb)';values=[args.p_op,args.p_args];}
 else{assert(['crm_device_gateway_v1','crm_device_member_gateway_v1'].includes(name));stmt='public.'+name+'($1,$2,$3,$4::jsonb)';values=[args.p_op,args.p_uid,args.p_fingerprint,args.p_args];}
 const r=await q('SELECT '+stmt+' AS v',values);await q('COMMIT');return {data:r.rows[0].v};}catch(e){await q('ROLLBACK');return {error:{message:e.message}};}}
 const fake={auth:()=>({getUserInfo:()=>({uid,isAnonymous:false})}),rdb:()=>({rpc})};
 global.fetch=async(url,options)=>{const u=new URL(url);assert.equal(u.host,'crm-testdevice.api.tcloudbasegateway.com');assert.equal(options.headers.Authorization,'Bearer isolated-service-key');
   if(u.pathname.endsWith('/rpc/crm_device_member_gateway_v1')){const r=await rpc('crm_device_member_gateway_v1',JSON.parse(options.body),{role:'service_role'});return Response.json(r.error||r.data,{status:r.error?400:200});}
   assert.ok(u.pathname.endsWith('/crm_device_challenges'));const vals=['id','fingerprint','audience','payload_hash'].map(k=>u.searchParams.get(k).slice(3));return Response.json((await q('SELECT uid FROM public.crm_device_challenges WHERE id=$1 AND fingerprint=$2 AND audience=$3 AND payload_hash=$4',vals)).rows);
 };
 const entry=(name,main)=>require('../../cloudfunctions/'+name+'/device-runtime').protect(name,main,()=>fake);
 const ctl=entry('person_360',()=>{throw Error('unexpected')});
 let childCall=()=>{throw Error('unexpected child')};fake.callFunction=async r=>r.data.action==='verifyBusinessDeviceOnly'?{result:await ctl(r.data)}:childCall(r);
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const key=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 const {fingerprint,state}=await ctl({action:'requestBrowserDevice',key,label:'synthetic'});assert.equal(state,'pending');
 async function signed(name,payload){
 const hash=digest(canonical(payload)),r=await ctl({action:'issueBrowserChallenge',audience:name,payloadHash:hash,fingerprint});
 if(!r.challenge)throw Error('not approved');
 const sig=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(deviceMessage(env,name,hash,r.challenge,fingerprint)));
 return {__deviceRequest:{...payload,__deviceProof:{fingerprint,challenge:r.challenge,signature:Buffer.from(sig).toString('base64url')}}};}
 let count=0;const customer=entry('customers',e=>{count++;return e.action;});
 assert.equal((await customer({action:'get',uid,confirmed:true})).error,'DEVICE_ACCESS_DENIED');await assert.rejects(signed('customers',{action:'get'}));
 await q("UPDATE public.crm_browser_devices SET state='approved' WHERE uid=$1",[uid]);
 const good=await signed('customers',{action:'get'});assert.equal(await customer({...good,action:'remove',userInfo:{uid:'fake'}}),'get');assert.equal((await customer(good)).error,'DEVICE_ACCESS_DENIED');assert.equal(count,1);
 const worker=entry('assistant',()=>({ok:true}));assert.equal((await worker({action:'knowledgeMcpInternal',assertion:{actorUid:uid},input:{}})).error,'DEVICE_ACCESS_DENIED');
 assert.equal((await worker({Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:'fake'})).error,'DEVICE_ACCESS_DENIED');
 process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY='synthetic-hmac-only-for-this-test-run';
 const input={tool:'knowledge_record_get',table:'knowledge_items',id:'9'};
 const assertion=require('../../cloudfunctions/assistant/knowledge-mcp-auth').signAssertion(uid,process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY,input);
 assert.equal((await worker({action:'knowledgeMcpInternal',assertion,input})).ok,true);
 assert.equal((await worker({action:'knowledgeMcpInternal',assertion,input:{...input,id:'10'}})).error,'DEVICE_ACCESS_DENIED');
 process.env.KNOWLEDGE_OCR_TRIGGER_SECRET='synthetic-timer-secret-only-for-this-test-run';
 assert.equal((await worker({Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:process.env.KNOWLEDGE_OCR_TRIGGER_SECRET})).ok,true);
 process.env.CRM_KNOWLEDGE_MCP_OWNER_UID='some-other-member';
 assert.equal((await worker(await signed('assistant',{action:'knowledgeMcpAuthorize'}))).error,'DEVICE_ACCESS_DENIED');
 process.env.CRM_KNOWLEDGE_MCP_OWNER_UID=uid;
 assert.equal((await worker(await signed('assistant',{action:'knowledgeMcpAuthorize'}))).ok,true);
 for(const {name} of require('../../cloudbaserc.json').functions){
  if(name==='knowledge_mcp')continue;
  const js=fs.readFileSync('cloudfunctions/'+name+'/index.js','utf8');
  assert.ok(js.trimEnd().endsWith("require('./device-runtime').protect('"+name+"', exports.main);"),name);
  const handler=entry(name,()=>{throw Error('private handler reached before authorization')});
  assert.equal((await handler({action:'list',confirmed:true,actorUid:uid})).error,'DEVICE_ACCESS_DENIED',name);
 }
 const delegateArgs={p_op:'issue',p_args:{audience:'person_360',payload_hash:digest('x'),origin:'mcp',actor:uid}};
 assert.ok((await rpc('crm_device_delegate_v1',delegateArgs,{role:'anon',claims:{role:'anon',sub:'public-key'}})).error);
 assert.ok((await rpc('crm_device_delegate_v1',delegateArgs,{role:'authenticated'})).error);
 const child=entry('person_360',e=>({person:e.personId}));let transfer;
 childCall=async r=>{transfer=r;return {result:await child(r.data)};};
 const parent=entry('assistant',async()=>internalCall(fake,{name:'person_360',data:{action:'getMeetingPrepContext',personId:'synthetic'}}));
 const nested=await parent(await signed('assistant',{action:'meetingPrep'}));assert.deepEqual(nested.result,{person:'synthetic'});assert.equal((await child(transfer.data)).error,'DEVICE_ACCESS_DENIED');
 const machineNested=await parent({action:'knowledgeMcpInternal',assertion,input});
 assert.deepEqual(machineNested.result,{person:'synthetic'});assert.equal(transfer.data.action,'getMeetingPrepContext');
 assert.equal(transfer.data.personId,'synthetic');assert.equal((await child(transfer.data)).error,'DEVICE_ACCESS_DENIED');
 const sess={actor:uid,origin:'browser',fingerprint};const st=async(p_op,s,p)=>{const r=await rpc('crm_device_file_stage_v1',{p_op,p_actor:s.actor,p_fp:s.fingerprint,p});if(r.error)throw Error(r.error.message);return r.data;};
 let stored,linked=null;const path='candidate_1/radar_123.png';
 const proxy=makeHandler({query:async()=>[{id:1,radar_image_file_id:linked}],stage:st,object:async(b,p,o)=>{
 assert.equal(b,'recruit');assert.equal(p,path);if(o.method==='POST'){const all=[];for await(const x of o.body)all.push(x);stored=Buffer.concat(all);return new Response(null,{status:201});}
 return new Response(stored,{status:206,headers:{'Content-Range':'bytes 0-4/5','Content-Type':'image/png'}});}});
 assert.ok((await rpc('crm_device_file_stage_v1',{p_op:'begin',p_actor:uid,p_fp:fingerprint,p:{}},{role:'authenticated'})).error);
 const {id}=await proxy({op:'begin',bucket:'recruit',path,bytes:5,type:'image/png'},sess);
 await proxy({op:'part',id,i:0,part:'aGVsbG8='},sess);await assert.rejects(proxy({op:'part',id,i:0,part:'d29ybGQ='},sess));
 await proxy({op:'finish',id},sess);assert.equal(stored.toString(),'hello');await assert.rejects(proxy({op:'download',bucket:'recruit',path,offset:0},sess));
 linked=path;assert.equal((await proxy({op:'download',bucket:'recruit',path,offset:0},sess)).part,'aGVsbG8=');
 await assert.rejects(proxy({op:'begin',bucket:'knowledge',path:'other/uuid/file.pdf',bytes:1},sess));
 const old=await signed('customers',{action:'get'});childCall=async r=>{transfer=r;return {};};
 await parent(await signed('assistant',{action:'meetingPrep'}));
 await q("UPDATE public.crm_browser_devices SET state='revoked' WHERE uid=$1",[uid]);
 assert.equal((await customer(old)).error,'DEVICE_ACCESS_DENIED');assert.equal((await child(transfer.data)).error,'DEVICE_ACCESS_DENIED');assert.equal(count,1);
 await assert.rejects(st('begin',sess,{bucket:'recruit',path,type:'image/png',bytes:4}));await assert.rejects(signed('customers',{action:'get'}));
 for(const m of ['20261110153100_device_file_parts','20261110153000_device_delegation']){if(m.endsWith('delegation'))await q("UPDATE public.crm_device_delegations SET expires_at=clock_timestamp()-interval '1 second'");await db.exec(mig(m+'.rollback'));}
 console.log('PASS: private entry, authenticated unapproved denial, signed request, metadata isolation, replay, delegated scope, forged machine calls, file staging and download, device revocation including outstanding calls, rollback');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
