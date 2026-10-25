'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {directoryPage}=require('../../cloudfunctions/activity_topics/resource-directory');
function service(name,tables,{personError=false}={}){
 const calls=[];
 const rdb={from(table){
  if(!Object.hasOwn(tables,table))throw Error('Unexpected table '+table);
  calls.push(table);const filters=[],sorts=[];let start=0,end=Infinity;
  const q={select(){return q},is(k,v){filters.push(r=>r[k]==v);return q},eq(k,v){filters.push(r=>r[k]===v);return q},
   lt(k,v){filters.push(r=>r[k]!=null&&r[k]<v);return q},gt(k,v){filters.push(r=>r[k]!=null&&r[k]>v);return q},
   lte(k,v){filters.push(r=>r[k]!=null&&r[k]<=v);return q},
   in(k,values){filters.push(r=>values.includes(r[k]));return q},order(k,o){sorts.push([k,o]);return q},
   range(a,b){start=a;end=b+1;return q},limit(n){end=n;return q},
   then(resolve,reject){return Promise.resolve().then(()=>{
    if(table==='persons'&&personError)throw Error('PERSON_READ_FAILED');
    const rows=tables[table].filter(r=>filters.every(f=>f(r))).sort((a,b)=>{
     for(const [k,o] of sorts){if(a[k]!==b[k])return (a[k]<b[k]?-1:1)*(o.ascending?1:-1)}return 0;
    });return{data:rows.slice(start,end)};
   }).then(resolve,reject)}};return q;
 }};
 const exports={};const context=vm.createContext({exports,require:dep=>{
  if(dep==='./db')return{rdb,assertOk:r=>r};
  if(dep==='./resource-directory')return require('../../cloudfunctions/'+name+'/resource-directory');
  throw Error('Unexpected dependency '+dep);
 }});
 new vm.Script(fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions',name,'index.js'),'utf8')).runInContext(context);
 return{call:event=>exports.main(event,{}),calls};
}
test('M06 searches topics beyond the old cap and pages matching rows without duplication',async()=>{
 const rows=Array.from({length:480},(_,i)=>({id:i+1,topic_name:'[CRM_TEST_ONLY] Topic '+i,updated_at:'2026-10-24',deleted_at:null,status:'active',keywords:i<75?['special']:[]}));
 const f=service('activity_topics',{activity_topics:rows});
 const first=await f.call({action:'directory',keyword:'SPECIAL',page:1,pageSize:50});
 const second=await f.call({action:'directory',keyword:'special',page:2,pageSize:50});
 assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);
 assert.equal(second.rows.length,25);assert.equal(second.hasMore,false);assert.equal(second.total,null);
 assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,75);
 const legacy=await f.call({action:'list'});assert.equal(legacy.rows.length,200);
});
test('M06 speaker search uses canonical Person name and organization beyond the old cap',async()=>{
 const rows=Array.from({length:250},(_,i)=>({id:i+1,person_id:i+1,name:'old name',updated_at:'2026-10-24',status:'active',relationship_stage:'new',deleted_at:null}));
 const persons=rows.map(r=>({id:r.id,display_name:'[CRM_TEST_ONLY] Person '+r.id,organization:r.id===1?'needle org':'regular',phone:'test-'+r.id,deleted_at:null}));
 const f=service('activity_speakers',{activity_speakers:rows,persons});
 for(const keyword of ['needle org','Person 1','test-1']){
  const result=await f.call({action:'directory',keyword,status:'active',stage:'new',pageSize:50});
  assert.ok(result.rows.some(r=>r.id===1)||result.hasMore);
  assert.ok(result.rows.every(r=>r.name.startsWith('[CRM_TEST_ONLY]')));
 }
 const fail=service('activity_speakers',{activity_speakers:rows,persons},{personError:true});
 assert.match((await fail.call({action:'directory',keyword:'needle'})).error,/PERSON_READ_FAILED/);
});
test('M06 rejects invalid paging and never represents a capped search as complete',async()=>{
 for(const event of [{page:0},{pageSize:51},{page:1.5},{status:'bad'},{keyword:'x'.repeat(121)}]){
  await assert.rejects(directoryPage(event,{read:()=>{throw Error('should not read')}}),/Invalid resource/);
 }
 let reads=0;
 await assert.rejects(directoryPage({keyword:'missing'},{read:async()=>{reads++;return Array.from({length:201},()=>({name:'other'}))},matches:()=>false}),/RESOURCE_SEARCH_LIMIT/);
 assert.equal(reads,50);
 let clock=0;
 await assert.rejects(directoryPage({keyword:'slow'},{now:()=>clock,read:async()=>{clock=7000;return[]},matches:()=>false}),/RESOURCE_SEARCH_LIMIT/);
 const page=await directoryPage({page:2,pageSize:20},{read:async(o,start,count)=>{assert.equal(start,20);assert.equal(count,21);return Array.from({length:21},(_,id)=>({id}))}});
 assert.equal(page.rows.length,20);assert.equal(page.hasMore,true);assert.equal(page.total,null);
});

test('L05 actual speaker directory combines server due/stage/status with canonical name before paging',async()=>{
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const rows=Array.from({length:260},(_,i)=>({id:i+1,person_id:i+1,name:'old',updated_at:'2026-10-24',
  deleted_at:null,status:i%2?'active':'inactive',relationship_stage:i%3?'stable':'new',
  next_contact_date:i%5===0?null:i%5===1?today:'2000-01-01'}));
 const persons=rows.map(r=>({id:r.id,display_name:'Fictional needle '+r.id,deleted_at:null}));
 const expected=rows.filter(r=>r.status==='active'&&r.relationship_stage==='stable'&&r.next_contact_date==='2000-01-01').reverse();
 const f=service('activity_speakers',{activity_speakers:rows,persons});
 const collected=[];
 for(const page of [1,2]){
  const result=await f.call({action:'directory',page,pageSize:20,keyword:'needle',status:'active',stage:'stable',due:'overdue'});
  assert.equal(result.error,undefined);collected.push(...result.rows.map(r=>r.id));
 }
 assert.deepEqual(collected,expected.slice(0,40).map(r=>r.id));
 const before=f.calls.length;
 assert.match((await f.call({action:'directory',due:'unsafe'})).error,/Invalid resource/);
 assert.equal(f.calls.length,before);
});
