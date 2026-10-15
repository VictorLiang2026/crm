'use strict';
// Follow only local JS/CSS referenced by admin.html / console.html and their imports.
// console.html 于 WP2 加入遍历入口：防止 console 模块链漏部署不被拦截（WP1 misc.js 教训）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const origin = 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const PAGES = ['admin.html', 'console.html'];
function comparable(file, contents) {
  // Static hosting can normalize CRLF to LF for HTML as well as JS/CSS.
  if (!/\.(?:html|js|css)$/.test(file)) return contents;
  return Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}
function matches(file, remote, local) {
  return sha(comparable(file, remote)).toLowerCase() === sha(comparable(file, local)).toLowerCase();
}
function assets() {
  const found = new Set(PAGES);
  const visit = file => {
    const source = fs.readFileSync(path.join(root,file),'utf8');
    const references = [...source.matchAll(/['"]((?:\/crm\/|\.\.\/|\.\/)[^'"\s]+\.(?:js|css))['"]/g)];
    for (const [,ref] of references) {
      const target = ref.startsWith('/crm/') ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file),ref));
      if (!target.startsWith('crm/') || target.includes('..') || !/\.(js|css)$/.test(target)) throw Error('Unsafe asset reference');
      if (!found.has(target)) { found.add(target); visit(target); }
    }
  };
  PAGES.forEach(visit);
  return [...found].sort();
}
async function main() {
  const results=[];
  for (const file of assets()) {
    const url=origin+(file.endsWith('.html')?'/crm/'+file:'/'+file);
    const r=await fetch(url,{signal:AbortSignal.timeout(30000),cache:'no-store'});
    const online=Buffer.from(await r.arrayBuffer());
    const local=fs.readFileSync(path.join(root,file));
    const pass=r.status===200 && matches(file, online, local);
    results.push({file,status:r.status,pass});
    if (!pass) throw Error('Online asset differs or unavailable: '+file);
  }
  console.log('[PASS] '+results.length+' reachable page/module/style assets match cloud');
}
if(require.main===module) main().catch(e=>{console.error('[FAIL] '+e.message);process.exitCode=1;});
module.exports={assets,comparable,matches};
