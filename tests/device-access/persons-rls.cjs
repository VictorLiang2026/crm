'use strict';
// Run in a disposable in-memory PostgreSQL. CRM_PGLITE_MODULE can point to a
// local @electric-sql/pglite module; no production connection is accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {PGlite} = require(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '../../cloudbase/migrations',name+'.sql'),'utf8');
(async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.persons(id int primary key,deleted_at timestamptz);
 INSERT INTO public.persons VALUES(1,null),(2,now());
 ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON public.persons TO anon, service_role;
 CREATE POLICY persons_anon_read ON public.persons FOR SELECT TO anon USING(deleted_at IS NULL);
 CREATE POLICY persons_service_only ON public.persons TO service_role USING(true) WITH CHECK(true);
 CREATE VIEW public.v_contract WITH (security_invoker=true) AS SELECT * FROM public.persons;
 GRANT SELECT ON public.v_contract TO anon;`);
 const read=async(role,claims,table='persons')=>{await db.exec('BEGIN; SET LOCAL ROLE '+role);
 try{await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
 return (await db.query('SELECT id FROM public.'+table+' ORDER BY id')).rows.map(x=>x.id)}
 finally{await db.exec('ROLLBACK')}};
 const pre='20261109191000_persons_server_read',cut='20261109191100_close_persons_public_read';
 assert.deepEqual(await read('anon',{role:'anon',sub:'published-key'}),[1]);
 await db.exec(sql(pre));
 const result=await db.query("SELECT md5(qual) AS guard FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons' AND policyname='persons_fn_read'");
 console.log('policy hash',result.rows[0].guard);
 await db.exec(sql(cut));
 for(const table of ['persons','v_contract']){
 assert.deepEqual(await read('anon',{role:'anon'},table),[1]);
 for(const c of [{role:'anon',sub:'published-key'},{role:'anon',sub:'anonymous-user'},{role:'anon',sub:null},{role:'anon',sub:''},{}, {role:'authenticated'}])
 assert.deepEqual(await read('anon',c,table),[]);}
 assert.deepEqual(await read('service_role',{role:'service_role'}),[1,2]);
 await assert.rejects(read('authenticated',{role:'authenticated',sub:'second-user'}),/permission denied/);
 await assert.rejects(db.exec(sql(cut+'.rollback')),/explicit incident approval/);
 await db.exec('ROLLBACK');
 await db.exec("SET crm_security.allow_exposure_rollback='yes'");
 await db.exec(sql(cut+'.rollback')); await db.exec(sql(pre+'.rollback'));
 assert.deepEqual(await read('anon',{role:'anon',sub:'old'}),[1]);
 console.log('PASS: split rollout, server path, view, two public identities, authenticated denial, deleted rows, guarded rollback');
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
