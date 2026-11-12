'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const modulePath=process.env.CRM_PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=require(modulePath),{pgcrypto}=require(path.join(path.dirname(require.resolve(modulePath)),'contrib/pgcrypto.cjs'));
const file=path.resolve(__dirname,'../../cloudbase/migrations/20261112091500_retire_online_registration');
test('retirement and schema rollback round trip without dropping new roster rows or an active registration',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE TABLE public.persons(id bigint PRIMARY KEY);
   CREATE TABLE public.activities(id integer PRIMARY KEY,actual_participants integer,deleted_at timestamptz);
   CREATE TABLE public.activity_participants(id bigint PRIMARY KEY,activity_id integer,roster_id bigint,canonical_person_id bigint);
   CREATE TABLE public.activity_roster_commands(activity_id bigint,operation text,completed_at timestamptz);
   INSERT INTO public.activities VALUES(1,1,null),(2,1,null); INSERT INTO public.activity_roster_commands VALUES(2,'import',now());
   INSERT INTO public.activity_participants VALUES(1,1,null),(2,2,45);`);
  const up=fs.readFileSync(file+'.sql','utf8'),down=fs.readFileSync(file+'.rollback.sql','utf8');
  await db.exec(down);
  await db.exec(`CREATE TABLE public.role_calls(id bigint);
   CREATE FUNCTION public.crm_person_roles_derive_v1(bigint) RETURNS void LANGUAGE sql AS 'INSERT INTO public.role_calls VALUES ($1)';
   CREATE TRIGGER crm_person_role_participants_sync AFTER INSERT OR UPDATE OR DELETE ON public.activity_participants FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();`);
  const page=(await db.query("INSERT INTO public.activity_registration_pages(activity_id,slug) VALUES(1,'fixture') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO public.activity_registration_submissions(page_id,attendee_name,wechat,management_token_hash) VALUES($1,'test','test',$2)",[page,'a'.repeat(64)]);
  await assert.rejects(db.exec(up),/data changed/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.activity_participants')).rows[0].n,2);
  await db.exec('DELETE FROM public.activity_registration_submissions');
  await db.exec(up);
  assert.deepEqual((await db.query('SELECT id FROM public.activity_participants')).rows.map(r=>Number(r.id)),[2]);
  assert.deepEqual((await db.query('SELECT actual_participants FROM public.activities ORDER BY id')).rows.map(r=>r.actual_participants),[null,1]);
  assert.equal((await db.query("SELECT to_regclass('public.activity_registration_pages') AS p")).rows[0].p,null);
  await db.exec('INSERT INTO public.activity_participants VALUES(3,2,46,NULL); UPDATE public.activity_participants SET canonical_person_id=8 WHERE id=3; UPDATE public.activity_participants SET canonical_person_id=NULL WHERE id=3; DELETE FROM public.activity_participants WHERE id=3');
  assert.deepEqual((await db.query('SELECT id FROM public.role_calls')).rows.map(r=>Number(r.id)),[8,8]);
  await db.exec(down);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.activity_registration_signers WHERE enabled')).rows[0].n,0);
 }finally{await db.close();}
});
