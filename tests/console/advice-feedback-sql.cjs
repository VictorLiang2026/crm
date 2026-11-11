'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.argv[2]);
const name='20261111203000_advice_feedback.sql';
const sql=dir=>fs.readFileSync(path.join(__dirname,'../../cloudbase',dir,name),'utf8');
(async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE TABLE public.persons(id bigint primary key,deleted_at timestamptz);
      CREATE TABLE public.ai_tasks(id bigint primary key,status text,subject_type text,subject_id text,task_type text,context_snapshot jsonb);
      CREATE TABLE public.ai_results(id bigint primary key,task_id bigint,result_json jsonb);
      CREATE TABLE public.activities(id bigint primary key,name text,deleted_at timestamptz);
      CREATE TABLE public.person_followup_advice(id bigint primary key,person_id bigint,title text,system_title text,system_strategy text,
        system_product_advice text,system_strategy_sources jsonb,system_product_sources jsonb,system_version int,system_status text,system_task_id bigint,
        gpt_title text,gpt_strategy text,gpt_product_advice text,gpt_strategy_sources jsonb,gpt_product_sources jsonb,gpt_based_on_system_version int,
        updated_at timestamptz,deleted_at timestamptz);
      CREATE TABLE public.effects(id uuid primary key);
      CREATE FUNCTION public.crm_ai_experience_decide_v1(text,uuid,bigint,text,text,jsonb) RETURNS void LANGUAGE sql AS 'insert into public.effects values ($2)';
      CREATE FUNCTION public.crm_ai_experience_outcome_v1(text,uuid,text,bigint,bigint,text,timestamptz,text) RETURNS void LANGUAGE sql AS 'insert into public.effects values ($2)';
      INSERT INTO public.persons VALUES (7,null);
      INSERT INTO public.activities VALUES(8,'Fixture',null);
      INSERT INTO public.ai_tasks VALUES(10,'completed','activity','8','activity_review','{}');
      INSERT INTO public.ai_results VALUES(11,10,'{"summary":"Fixture activity"}');
      INSERT INTO public.person_followup_advice(id,person_id,title,system_strategy,system_product_advice,system_version,system_status,
        gpt_strategy,gpt_based_on_system_version,updated_at) VALUES(9,7,'Fixture','Strategy','Product',1,'ready','GPT content',1,now());
      GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT INSERT ON public.effects TO service_role;`);
    await db.exec(sql('migrations'));await db.exec(sql('rollbacks'));await db.exec(sql('migrations'));
    await db.exec(`insert into public.ai_tasks values(15,'completed','person','7','person_followup_advice','{}');
      insert into public.ai_results values(16,15,'{}');update public.person_followup_advice set system_task_id=15;`);
    await db.exec('SET ROLE service_role');
    const run=async(op,arg,actor='operator')=>(await db.query('select public.crm_advice_feedback_v1($1,$2,$3) as result',[actor,op,JSON.stringify(arg)])).rows[0].result;
    const target={subjectId:7,adviceId:9,lane:'system'};
    const gpt={...target,lane:'gpt'},act={subjectId:8,adviceId:11,lane:'activity'};
    const preview=async(t,decision='accepted',extra={})=>run('preview',{...t,versionKey:(await run('read',t)).versionKey,decision,...extra});
    const confirm=id=>run('confirm',{previewId:id});
    await assert.rejects(run('read',{...target,subjectId:99}));
    await assert.rejects(preview(target,'modified'));
    const first=await preview(target);await assert.rejects(run('confirm',{previewId:first.previewId},'other'));
    await confirm(first.previewId);assert.equal((await confirm(first.previewId)).replayed,true);
    const stale=await preview(gpt);
    await db.exec("update public.person_followup_advice set gpt_strategy='Edited GPT'");
    await assert.rejects(confirm(stale.previewId));
    assert.equal((await run('read',gpt)).rows.length,0);
    await db.exec("update public.person_followup_advice set system_strategy='Edited', system_version=2");
    const outcome=await preview(target,'outcome',{priorId:first.previewId,note:'Observed',evidence:'Recorded call'});
    assert.equal(outcome.version,'1');await confirm(outcome.previewId);
    assert.equal((await run('read',target)).rows.length,2);
    const activity=await preview(act,'modified',{note:'Adjusted plan'});await confirm(activity.previewId);
    const actual=await preview(act,'outcome',{note:'Case ended',evidence:'Operator log'});await confirm(actual.previewId);await confirm(actual.previewId);
    assert.equal((await db.query('select count(*)::int n from public.effects')).rows[0].n,3);
    await db.exec('update public.persons set deleted_at=now()');await assert.rejects(run('read',target));
    await db.exec('SET ROLE anon');await assert.rejects(run('read',act));
    await db.exec('RESET ROLE');await assert.rejects(db.exec(sql('rollbacks')));
    console.log('PASS version binding, historical outcome, preview ownership, missing evidence, soft deletion, rollback guard and duplicate confirmation');
  } finally {await db.close();}
})().catch(e=>{console.error(e.message,e.position,e.internalPosition,e.where,e.internalQuery);if(e.position){const p=Number(e.position);console.error(sql('migrations').slice(p-180,p+80));};process.exitCode=1;});
