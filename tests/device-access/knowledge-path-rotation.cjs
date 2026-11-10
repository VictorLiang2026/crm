'use strict';
const {PGlite}=require(process.env.CRM_PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {makeWorker}=require('../../tools/maintenance/device-knowledge-rotation.cjs');
(async()=>{const db=new PGlite(),files=new Map(),q=(s,p)=>db.query(s,p);try{
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA storage;CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);CREATE TABLE public.knowledge_sources(id bigint PRIMARY KEY,storage_key text,file_size_bytes bigint,created_by text,metadata jsonb);");
 for(let i=1;i<=21;i++){const k='synthetic/id/'+i+'.txt',n=i===21?140016171:1;files.set(k,n);
 await q("INSERT INTO storage.objects VALUES('knowledge',$1,$2)",[k,JSON.stringify({size:n})]);
 await q("INSERT INTO public.knowledge_sources VALUES ($1,$2,$3,'synthetic',$4)",[i,k,n,JSON.stringify({upload:{phase:'complete'}})]);}
 await db.exec(fs.readFileSync('cloudbase/migrations/20261110221000_device_knowledge_path_rotation.sql','utf8'));
 const rpc=async(op,id=null,l=null,e=null)=>(await q('SELECT public.crm_knowledge_path_rotation_v1($1,$2,$3,$4) AS v',[op,id,l,e])).rows[0].v;
 let wrongSize=false;
 const worker=makeWorker({rpc,object:async(k,m)=>{if(m==='DELETE'){files.delete(k);return new Response(null,{status:200});}assert.equal(m,'HEAD');return new Response(null,{status:files.has(k)?200:404,headers:{'Content-Length':String(files.get(k)||0)}});},
 copy:async(a,b)=>{files.set(b,files.get(a)+(wrongSize?1:0));return new Response(null,{status:200});}});
 assert.equal(await worker(),true);assert(!files.has('synthetic/id/1.txt'));assert.equal(await worker(),false);
 await q("UPDATE public.crm_knowledge_path_rotation SET ready=true WHERE source_id=2");wrongSize=true;
 await assert.rejects(worker(),/NEW_SIZE/);assert(files.has('synthetic/id/2.txt'));assert.equal((await q('SELECT storage_key FROM public.knowledge_sources WHERE id=2')).rows[0].storage_key,'synthetic/id/2.txt');
 assert.equal(await worker(),false);console.log('PASS: first-only release, reference switch before removal, mismatch preserves original and stops further rotations');
 }finally{await db.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
