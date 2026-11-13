'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {checkedVolume,documentService}=require('../../cloudfunctions/assistant/knowledge-documents');
const {projectContent,volumeNumber}=require('../../cloudfunctions/assistant/knowledge-content');
const migration=ext=>fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261113104500_knowledge_documents'+ext),'utf8');

test('registry assigns global numbers, preserves legacy routes, excludes drafts and revokes stale GPT',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE public.knowledge_sources(id bigint primary key,created_by text,title text,sha256 text, metadata jsonb default '{}',deleted_at timestamptz,lifecycle_status text,review_at date,valid_from date,valid_to date,version_no integer,updated_at timestamptz);
   CREATE TABLE public.knowledge_items(id bigint primary key,created_by text,source text,source_id bigint,supersedes_id bigint,metadata jsonb default '{}',deleted_at timestamptz,verified boolean,lifecycle_status text,valid_from date,valid_to date,content_state jsonb default '{}',content text,version_no integer,updated_at timestamptz);
   CREATE TABLE public.playbooks(id bigint primary key,created_by text,scenario text,metadata jsonb default '{}',supersedes_id bigint);
   INSERT INTO public.knowledge_sources(id,created_by,title,sha256,lifecycle_status) VALUES
   (35,'fixture','A','a88ddaf9e0350950b78df66b72f221fcde83169bdb5ce711da1aa6bb76e5a24d','verified'),
   (36,'fixture','B','2d70c39b32a07fde57e31c5cc3a278c8359b5f0138962d2fb969107d5a692f3c','draft'),
   (37,'fixture','C','e5add151344acba7f8d984e189f8c9c935deda9e5793d72192c33f000ebcafb1','verified');
   INSERT INTO public.knowledge_items(id,source_id,created_by,source,metadata,content,verified,lifecycle_status) VALUES
   (15,35,'fixture','A','{"summary":"first"}','body 1',true,'verified'),(14,36,'fixture','B','{"summary":"draft"}','body 2',false,'draft'),
   (16,37,'fixture','C','{"summary":"last"}','body 3',true,'verified'),(12,NULL,'fixture','single','{}','body',true,'verified');
   INSERT INTO public.playbooks(id,created_by,scenario) VALUES(12,'fixture','strategy');`);
  await db.exec(migration('.sql'));
  const overview=async()=>(await db.query('SELECT public.crm_knowledge_document_read_v1(100001) value')).rows[0].value;
  let o=await overview();assert.deepEqual(o.parts.map(v=>[v.part,v.start,v.end]),[[1,1,30],[3,61,85]]);
  assert.equal(o.total,3);assert.equal(o.pages,85);
  const nums=await db.query("SELECT metadata#>>'{document,number}' n FROM public.knowledge_items WHERE id=12 UNION SELECT metadata#>>'{document,number}' FROM public.playbooks WHERE id=12");assert.equal(nums.rows.length,2);
  await db.query('UPDATE public.knowledge_documents SET gpt_basis=$1,gpt_summary=$2 WHERE id=100001',[o.basis,'approved scope']);assert.equal((await overview()).gpt,'approved scope');
  await db.exec("UPDATE public.knowledge_sources SET deleted_at=now() WHERE id=37");o=await overview();assert.equal(o.parts.length,1);assert.equal(o.gpt,null);assert.equal(o.needsReview,true);
  const restricted=await db.query("SELECT has_table_privilege('anon','public.knowledge_document_chunks','SELECT') permission,has_function_privilege('authenticated','public.crm_knowledge_document_read_v1(bigint)','EXECUTE') execute");assert.deepEqual(restricted.rows[0],{permission:false,execute:false});
  await assert.rejects(db.exec(migration('.rollback.sql')),/Export document/);await db.exec('ROLLBACK;UPDATE public.knowledge_documents SET gpt_summary=NULL;');await db.exec(migration('.rollback.sql'));
  assert.equal((await db.query("SELECT count(*)::int n FROM public.knowledge_items WHERE metadata?'document'")).rows[0].n,0);
 }finally{await db.close();}
});
test('service scopes writes, checks original hash, resumes chunks and rejects stale summaries',async()=>{
 const bytes=Buffer.from('%PDF-fixture'),hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const doc={id:123,original_size:bytes.length,original_sha256:hash,original_name:'x.pdf',page_count:35,part_count:2},chunks=[];
 const req=async(table,method,filters,body)=>{
   if(table==='knowledge_documents'){
     if(method==='GET')return filters.owner_uid==='eq.staff'?[doc]:[];
     Object.assign(doc,body);return [doc];
   }
   if(method==='POST'){if(chunks.length)throw Object.assign(Error(),{code:'DUPLICATE_SOURCE'});chunks.push(body[0]);}
   return chunks;
 };
 const svc=documentService(req,async()=>({data:{parts:[{}],basis:'v',gptVersion:2}}));
 await assert.rejects(svc.run('documentOverview',{id:123},'outsider'),/UNAVAILABLE/);
 await assert.rejects(svc.run('documentComplete',{id:123},'staff'),/INCOMPLETE/);
 const d={id:123,part:0,data:bytes.toString('base64')};
 await svc.run('documentChunk',d,'staff');await svc.run('documentChunk',d,'staff');
 await svc.run('documentComplete',{id:123},'staff');assert.equal(doc.original_ready,true);
 assert.equal((await svc.run('documentOriginal',{id:123,part:0},'staff')).data,d.data);
 assert.throws(()=>checkedVolume({index:2,start:30,end:35},doc));
 assert.equal(checkedVolume({index:2,start:31,end:35},doc).end,35);
 await assert.rejects(svc.run('documentGpt',{id:123,basis:'v',version:1,summary:'x'},'staff'),/CONFLICT/);
 assert.equal(volumeNumber('100001',2),'0001-02');
 assert.equal(volumeNumber(109999,99),'9999-99');
 assert.equal(volumeNumber(110001,2),'110001-02');
 const row={id:15,content:'Reviewed text',metadata:{document:{number:123,part:1,total:2,start:1,end:30,title:'x'}}};
 assert.equal(projectContent(row,'knowledge_items',null).contentReference.locator,'0123-01 pp. 1–30');
});
