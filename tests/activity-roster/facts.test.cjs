'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');

const migration = name => fs.readFileSync(path.join(__dirname, '../../cloudbase/migrations', name + '.sql'), 'utf8');
test('home roster facts work for an empty list, dates, activities and linked or independent attendees', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.activities(id int PRIMARY KEY, activity_date date, deleted_at timestamptz);
      CREATE TABLE public.persons(id bigint PRIMARY KEY, display_name text, name_key text, wechat text, phone text, organization text, deleted_at timestamptz);
      CREATE TABLE public.activity_participants(id bigint PRIMARY KEY, activity_id int, canonical_person_id bigint, status text, participant_role text,
        followup_status text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
      CREATE TABLE public.customers("Id" bigint PRIMARY KEY, person_id bigint, deleted_at timestamptz);
      CREATE TABLE public.recruit_candidates(id bigint PRIMARY KEY, person_id bigint, deleted_at timestamptz);
      CREATE TABLE public.activity_speakers(id bigint PRIMARY KEY, person_id bigint, deleted_at timestamptz);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;`);
    await db.exec(migration('20261112085000_activity_roster'));
    const facts = async input => (await db.query("SELECT public.crm_activity_roster_v1('today_coach','facts',$1)->'rows' AS rows", [input])).rows[0].rows;
    const home = { since: '0001-01-01', after: 0 };
    await db.exec('SET ROLE service_role');
    await assert.rejects(facts(home), { code: '42703' });
    await db.exec('RESET ROLE');
    const fix = '20261112093500_roster_facts_customer_alias';
    await db.exec(migration(fix));
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await facts(home), []);
    await db.exec('RESET ROLE');
    await db.exec(`INSERT INTO public.activities VALUES (1,'2026-11-01',NULL),(2,'2026-11-02',now());
      INSERT INTO public.persons(id,display_name,name_key) VALUES (1,'Test A','test a'),(2,'Test B','test b'),(3,'Test C','test c');
      INSERT INTO public.activity_roster_people(id,person_id,display_name,name_key) VALUES
        (1,1,'Test A','test a'),(2,2,'Test B','test b'),(3,3,'Test C','test c'),(4,NULL,'Test D','test d');
      INSERT INTO public.customers VALUES(21,1,NULL);
      INSERT INTO public.recruit_candidates VALUES(22,2,NULL);
      INSERT INTO public.activity_speakers VALUES(23,3,NULL);
      INSERT INTO public.activity_participants(id,activity_id,canonical_person_id,roster_id,deleted_at) VALUES
        (1,1,1,1,NULL),(2,1,2,2,NULL),(3,1,3,3,NULL),(4,1,NULL,4,NULL),(5,2,1,1,NULL),(6,1,1,1,now());
      SET ROLE service_role;`);
    const rows = await facts(home);
    assert.deepEqual(rows.map(r => r.person_type), ['customer','recruit','speaker','attendee']);
    assert.deepEqual(rows.map(r => r.person_id), [21,22,23,null]);
    for (const row of rows.slice(0,3)) {
      assert.deepEqual(await facts({ personType:row.person_type, legacyId:row.person_id }), [row]);
    }
    assert.deepEqual(await facts({ activityIds:[1], after:2 }), rows.slice(2));
    assert.deepEqual(await facts({ since:'2026-11-02' }), []);
    await db.exec('RESET ROLE');
    await db.exec(migration(fix + '.rollback'));
    await db.exec('SET ROLE service_role');
    await assert.rejects(facts(home), { code: '42703' });
    await db.exec('RESET ROLE');
    await db.exec(migration(fix));
    await db.exec('SET ROLE anon');
    await assert.rejects(facts(home), { code: '42501' });
  } finally { await db.close(); }
});
