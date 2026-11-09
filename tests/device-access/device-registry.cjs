'use strict';
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.CRM_PGLITE_MODULE||'@electric-sql/pglite');const {deviceProtocol,canonical,digest,deviceMessage}=require('../../cloudfunctions/_shared/device-proof.js');
(async()=>{
 const db=new PGlite(),env='test-only',owner={uid:'owner'},other={uid:'other'},allowed=new Set(['customers','person_360']),event={action:'get',id:19};
 const q=s=>db.exec(s);
 const read=async(role,claims,op,uid,fp,args)=>{await q('BEGIN;SET LOCAL ROLE '+role);
 try{await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
 const r=await db.query('SELECT public.crm_device_gateway_v1($1,$2,$3,$4::jsonb) AS v',[op,uid,fp,JSON.stringify(args)]);await q('COMMIT');return r.rows[0].v}
 catch(e){await q('ROLLBACK');throw e}};
 const auth=deviceProtocol({env,permitted:allowed,rpc:(...args)=>read('anon',{role:'anon'},...args)});
 const device=async(label,actor=owner)=>{const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 await assert.rejects(webcrypto.subtle.exportKey('jwk',keys.privateKey));
 const key=await webcrypto.subtle.exportKey('jwk',keys.publicKey),{fingerprint}=await auth.enroll(actor,{key,label});
 return {fingerprint,key,sign:async(name,data=event)=>{const payloadHash=digest(canonical(data)),{challenge}=await auth.issue(actor,{fingerprint,audience:name,payloadHash});
 const signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,Buffer.from(deviceMessage(env,name,payloadHash,challenge,fingerprint)))).toString('base64url');
 return {...data,__deviceProof:{fingerprint,challenge,signature}}}}};
 try{
 await q('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
 await q(fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261109194000_device_registry.sql'),'utf8'));
 await q("INSERT INTO public.crm_access_members(uid) VALUES('owner'),('second')");
 const a=await device('A'),b=await device('B');await assert.rejects(a.sign('customers'),/DEVICE_NOT_APPROVED/);
 await assert.rejects(auth.enroll(other,{key:a.key,label:'impostor'}),/DENIED/);
 await assert.rejects(read('anon',{role:'anon',sub:'published-key'},'request','owner',a.fingerprint,{}),/DENIED/);
 await q('SET ROLE authenticated');await assert.rejects(q("UPDATE public.crm_browser_devices SET state='approved'"),/denied/);await q('RESET ROLE');
 await q("UPDATE public.crm_browser_devices SET state='approved'");const proof=await a.sign('customers');
 await assert.rejects(auth.authorize(owner,'person_360',proof));await assert.rejects(auth.authorize(owner,'customers',{...proof,id:21}));
 await assert.rejects(auth.authorize(other,'customers',proof));assert.deepEqual(await auth.authorize(owner,'customers',proof),event);
 await assert.rejects(auth.authorize(owner,'customers',proof));const beforeRevoke=await a.sign('customers');
 await db.query("UPDATE public.crm_browser_devices SET state='revoked' WHERE fingerprint=$1",[a.fingerprint]);
 await assert.rejects(auth.authorize(owner,'customers',beforeRevoke));await assert.rejects(a.sign('customers'));
 assert.deepEqual(await auth.authorize(owner,'customers',await b.sign('customers')),event);
 await assert.rejects(db.query("UPDATE public.crm_browser_devices SET state='approved' WHERE fingerprint=$1",[a.fingerprint]),/immutable/);
 const second={uid:'second'},c=await device('C',second);
 await assert.rejects(c.sign('customers'));
 await db.query("UPDATE public.crm_browser_devices SET state='approved' WHERE uid='second' AND fingerprint=$1",[c.fingerprint]);
 const cp=await c.sign('customers');await assert.rejects(auth.authorize(owner,'customers',cp));
 assert.deepEqual(await auth.authorize(second,'customers',cp),event);
 const stale=await c.sign('customers');await q("UPDATE public.crm_access_members SET enabled=false WHERE uid='second'");
 await assert.rejects(auth.authorize(second,'customers',stale));
 await q("UPDATE public.crm_access_members SET enabled=true WHERE uid='second'");
 await assert.rejects(c.sign('customers'));assert.deepEqual(await auth.authorize(owner,'customers',await b.sign('customers')),event);
 console.log('PASS: isolated multi-member enrollment, two nonextractable signing keys, pending denial, no client approval, data/route binding, replay, immediate revocation, unaffected second device');
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
