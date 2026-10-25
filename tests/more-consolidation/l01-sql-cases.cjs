'use strict';
// Produces read-only SQL using the exact migration SELECT and entirely synthetic CTEs.
// Run each query with queryPgDatabase(action=sql); compare total and ids to expected.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'cloudbase/migrations/20261025190000_person_customer_worklist.sql'),'utf8');
const fixtures=fs.readFileSync(path.join(__dirname,'l01-fixtures.sql'),'utf8');
const cases=[['overdue',20,[11,10,9,8,7,6,5,4,3,2,1],31],['today',0,[32],1],['month',0,[33],1],
 ['stale',0,[35],1],['unknown',0,[38],1],['unlinked',0,[39],1],['normal',0,[36,37,34],3]];
module.exports=cases.map(([status,offset,ids,total])=>({status,expected:{ids,total},sql:source.split('$query$')[1]
 .replace('WITH base AS',`WITH ${fixtures}, base AS`)
 .replaceAll(/public\.(persons|customers|person_roles|recruit_candidates|followups)\b/g,'fixture_$1')
 .replace('%s','wb_sort ASC NULLS LAST, id ASC')
 .replaceAll('$1',"''::text").replaceAll('$2',"'[]'::jsonb").replaceAll('$3',"DATE '2026-10-25'")
 .replaceAll('$4',`'${status}'::text`).replaceAll('$5','20').replaceAll('$6',String(offset))}));
if(require.main===module)process.stdout.write(JSON.stringify(module.exports));
