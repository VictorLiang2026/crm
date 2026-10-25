'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {directoryOptions,contactFilter,directoryPage}=require('../../cloudfunctions/activity_speakers/resource-directory');
test('L05 due buckets use inclusive end and exclude missing dates; combined filters precede paging',async()=>{
 const today='2026-12-31';
 const rows=Array.from({length:160},(_,i)=>({id:i+1,status:i%2?'active':'inactive',stage:i%5?'stable':'new',date:[null,'2026-12-30',today,'2027-01-01','2027-01-07','2027-01-08'][i%6],name:'needle'}));
 const qFor=(source)=>{
  const filters=[];
  const q={lt(k,v){filters.push(r=>r.date!=null&&r.date<v);return q},gt(k,v){filters.push(r=>r.date!=null&&r.date>v);return q},lte(k,v){filters.push(r=>r.date!=null&&r.date<=v);return q},
   eq(k,v){filters.push(r=>r.date===v);return q},is(k,v){filters.push(r=>r.date===v);return q},rows:()=>source.filter(r=>filters.every(f=>f(r)))};
  return q;
 };
 const expected={overdue:r=>r.date==='2026-12-30',today:r=>r.date===today,next7:r=>['2027-01-01','2027-01-07'].includes(r.date),unscheduled:r=>r.date===null};
 for(const [due,predicate] of Object.entries(expected)){
  assert.deepEqual(contactFilter(qFor(rows),{due,today}).rows().map(r=>r.id),rows.filter(predicate).map(r=>r.id));
 }
 const eligible=rows.filter(r=>r.status==='active'&&r.stage==='stable'&&expected.next7(r));
 assert.ok(eligible.length>6);
 const seen=[];
 for(let page=1;page<=2;page++){
  const result=await directoryPage({page,pageSize:3,keyword:'needle',status:'active',stage:'stable',due:'next7'},{
   read:async(o,offset,count)=>contactFilter(qFor(rows.filter(r=>r.status===o.status&&r.stage===o.stage)),{...o,today}).rows().slice(offset,offset+count),
   matches:(r,k)=>r.name.includes(k)
  });seen.push(...result.rows.map(r=>r.id));
 }
 assert.deepEqual(seen,eligible.slice(0,6).map(r=>r.id));
 assert.equal(new Set(seen).size,seen.length);
 for(const due of ['all_data',0,false,{}]) assert.throws(()=>directoryOptions({due}),/Invalid resource/);
});

