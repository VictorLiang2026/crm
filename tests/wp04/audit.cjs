'use strict';
const kinds=['customers','recruits','speakers','participants'];
function evaluate(snapshot, exceptions, now=Date.now()){
 const failures=[],check=(ok,message)=>{if(!ok)failures.push(message);};
 check(snapshot?.version==='wp04-v1'&&snapshot?.schema==='public'&&snapshot?.environment==='crm-d1gkae8ddc930d151','Wrong audit scope/version');
 const age=now-Date.parse(snapshot?.observedAt);check(Number.isFinite(age)&&age>=-60000&&age<=3600000,'Identity audit missing or expired');
 const rows=Array.isArray(snapshot?.summary)?snapshot.summary:[],issues=Array.isArray(snapshot?.exceptions)?snapshot.exceptions:[];
 check(rows.length===kinds.length&&new Set(rows.map(r=>r.kind)).size===kinds.length,'Incomplete identity summary');
 check(Array.isArray(snapshot?.exceptions),'Missing exception evidence');
 check(snapshot?.initialTestRows===10,'Initial test ledger must remain 10');
 const key=r=>r.kind+':'+r.id+':'+r.issue;
 const allowed=new Set(exceptions.map(key));
 check(allowed.size===exceptions.length,'Duplicate declared exceptions');
 check(new Set(issues.map(r=>r.kind+':'+r.id)).size===issues.length,'Duplicate exception records');
 for(const row of rows){
  check(kinds.includes(row.kind),'Unknown identity kind');
  check(['active','mapped','exceptions'].every(k=>Number.isSafeInteger(row[k])&&row[k]>=0),'Invalid identity counts');
  check(row.mapped+row.exceptions===row.active,'Coverage does not total 100%');
  check(issues.filter(x=>x.kind===row.kind).length===row.exceptions,'Exception count differs from detail');
 }
 for(const item of issues){
  check(kinds.includes(item.kind)&&/^[1-9]\d*$/.test(item.id),'Invalid exception identity');
  check(['UNMAPPED_CUSTOMER','NAME_ONLY_UNCONFIRMED'].includes(item.issue),'Conflicting or invalid explicit identity');
  check(allowed.has(key(item)),'Unreviewed identity exception: '+key(item));
 }
 return {failures,coverage:rows,declaredExceptions:issues.length,status:failures.length?'FAIL':issues.length?'PASS_WITH_EXCEPTIONS':'PASS'};
}
module.exports={evaluate};
