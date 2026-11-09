'use strict';
// Production read-only check: HEAD only. Never return a row or a credential.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base='https://crm-d1gkae8ddc930d151.api.tcloudbasegateway.com';
const keyfile=process.env.CRM_PUBLIC_KEY_FILE||path.join(__dirname,'../permissions/.results/public-key.txt');
const devicefile=path.join(path.dirname(keyfile),'person-gateway-audit-device.txt');
const request=(p,o)=>fetch(base+p,{...o,signal:AbortSignal.timeout(15000)});
(async()=>{
 const key=fs.readFileSync(keyfile,'utf8').trim();
 if(!fs.existsSync(devicefile)) fs.writeFileSync(devicefile,crypto.randomUUID(),{flag:'wx',mode:0o600});
 const device=fs.readFileSync(devicefile,'utf8').trim();
 const session=await request('/auth/v1/signin/anonymously',{method:'POST',headers:{'x-device-id':device,'content-type':'application/json'},body:'{}'});
 const anon=await session.json();if(!session.ok||anon.scope!=='anonymous'||!anon.access_token) throw Error('Anonymous identity not verified');
 for(const [mode,token] of [['no_credentials',null],['public_key',key],['anonymous_session',anon.access_token]]){
  const r=await request('/v1/rdb/rest/persons?select=display_name,phone&limit=0',{method:'HEAD',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Accept-Profile':'public',Prefer:'count=exact'}});
  const empty=r.headers.get('content-range')==='*/0';
  if(token ? r.status!==200||!empty : r.status!==401)throw Error(mode+' did not produce the expected denial or empty result');
  console.log(mode,r.status,token?'zero visible rows':'denied');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
