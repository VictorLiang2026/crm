'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {evaluate}=require('./audit.cjs');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'tests/security/.results');
const file=path.join(dir,'wp04-audit.json');
if(!fs.existsSync(file))throw Error('Export fresh tests/wp04/audit.sql through authorized read-only CloudBase PG first');
const result=evaluate(JSON.parse(fs.readFileSync(file,'utf8')),require('./exceptions.json'));
console.log(JSON.stringify(result));
let fixtureStatus='NOT_RUN';
if(!result.failures.length){
 const tests=spawnSync(process.execPath,['--test','tests/wp04/run.test.cjs'],{cwd:root,stdio:'inherit',windowsHide:true});
 fixtureStatus=tests.status===0?'PASS':'FAIL';
 if(fixtureStatus==='FAIL'){result.status='FAIL';result.failures.push('Identity fixture tests failed');}
}
fs.writeFileSync(path.join(dir,'wp04-report.json'),JSON.stringify({...result,fixtureStatus,observedAt:new Date().toISOString()},null,2));
process.exitCode=result.failures.length?1:0;
