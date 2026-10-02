'use strict';
// Follow only local JS/CSS referenced by admin.html and its imports.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const origin = 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
function assets() {
  const found = new Set(['admin.html']);
  const visit = file => {
    const source = fs.readFileSync(path.join(root,file),'utf8');
    const references = [...source.matchAll(/['"]((?:\/crm\/|\.\.\/|\.\/)[^'"\s]+\.(?:js|css))['"]/g)];
    for (const [,ref] of references) {
      const target = ref.startsWith('/crm/') ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file),ref));
      if (!target.startsWith('crm/') || target.includes('..') || !/\.(js|css)$/.test(target)) throw Error('Unsafe asset reference');
      if (!found.has(target)) { found.add(target); visit(target); }
    }
  };
  visit('admin.html');
  return [...found].sort();
}
async function main() {
  const results=[];
  for (const file of assets()) {
    const url=origin+(file==='admin.html'?'/crm/admin.html':'/'+file);
    const r=await fetch(url,{signal:AbortSignal.timeout(30000),cache:'no-store'});
    const pass=r.status===200 && sha(Buffer.from(await r.arrayBuffer()))===sha(fs.readFileSync(path.join(root,file)));
    results.push({file,status:r.status,pass});
    if (!pass) throw Error('Online asset differs or unavailable: '+file);
  }
  console.log('[PASS] '+results.length+' reachable page/module/style assets match cloud');
}
if(require.main===module) main().catch(e=>{console.error('[FAIL] '+e.message);process.exitCode=1;});
module.exports={assets};
