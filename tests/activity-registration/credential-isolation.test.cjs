'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');
const sha = value => createHash('sha256').update(value).digest('hex');

// Database-only acceptance fixture. The header session setting models PostgREST;
// it makes no claim about header forwarding or redaction in the hosted gateway.
test('independent application credentials authorize only their registration workflow and revoke separately', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE public.activities(id bigint PRIMARY KEY, deleted_at timestamptz);
      CREATE TABLE public.persons(id bigint PRIMARY KEY, deleted_at timestamptz);
      INSERT INTO public.activities VALUES (1, NULL);
      GRANT SELECT, UPDATE ON public.activities, public.persons TO service_role;
    `);
    for (const version of ['20261110110000_activity_registration', '20261110160000_activity_registration_shared_token', '20261111230000_activity_registration_write']) {
      await db.exec(readFileSync(path.resolve(__dirname, '../../cloudbase/migrations', version + '.sql'), 'utf8'));
    }
    await db.exec(`
      CREATE TABLE public.fixture_registration_credentials(scope text PRIMARY KEY, digest bytea NOT NULL, enabled boolean NOT NULL);
      REVOKE ALL ON public.fixture_registration_credentials FROM PUBLIC, anon, authenticated;
      GRANT SELECT ON public.fixture_registration_credentials TO service_role;
      CREATE FUNCTION public.fixture_registration_auth(required_scope text) RETURNS void
      LANGUAGE plpgsql SET search_path = pg_catalog AS $$
      DECLARE credential text := nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-registration-credential';
      BEGIN
        IF credential IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.fixture_registration_credentials
          WHERE scope = required_scope AND enabled AND digest = sha256(convert_to(credential, 'UTF8'))
        ) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
      END $$;
      REVOKE ALL ON FUNCTION public.fixture_registration_auth(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.fixture_registration_auth(text) TO service_role;
      CREATE FUNCTION public.fixture_registration_submit(payload jsonb) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
      BEGIN PERFORM public.fixture_registration_auth('public');
        RETURN public.crm_activity_registration_write_v1('submit', payload);
      END $$;
      CREATE FUNCTION public.fixture_registration_review(payload jsonb) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
      BEGIN PERFORM public.fixture_registration_auth('staff');
        RETURN public.crm_activity_registration_write_v1('review', payload);
      END $$;
      ALTER FUNCTION public.fixture_registration_submit(jsonb) OWNER TO service_role;
      ALTER FUNCTION public.fixture_registration_review(jsonb) OWNER TO service_role;
      REVOKE ALL ON FUNCTION public.fixture_registration_submit(jsonb),public.fixture_registration_review(jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.fixture_registration_submit(jsonb),public.fixture_registration_review(jsonb) TO anon;
    `);
    const keys = { public: randomBytes(32).toString('base64url'), staff: randomBytes(32).toString('base64url') };
    for (const [scope, key] of Object.entries(keys)) {
      await db.query("INSERT INTO public.fixture_registration_credentials VALUES ($1,decode($2,'hex'),true)", [scope,sha(key)]);
    }
    await db.exec('SET ROLE service_role');
    const page = (await db.query("INSERT INTO public.activity_registration_pages(activity_id,slug,status) VALUES(1,'fictional-event','published') RETURNING id")).rows[0].id;
    await db.exec('RESET ROLE; SET ROLE anon');
    const submit = payload => db.query('SELECT public.fixture_registration_submit($1) result',[payload]);
    const review = payload => db.query('SELECT public.fixture_registration_review($1) result',[payload]);
    const credential = key => db.query("SELECT set_config('request.headers',$1,false) IS NOT NULL", [JSON.stringify({'x-registration-credential':key})]);
    const enabled = async (scope, value) => {
      await db.exec('RESET ROLE');
      await db.query('UPDATE public.fixture_registration_credentials SET enabled=$2 WHERE scope=$1',[scope,value]);
      await db.exec('SET ROLE anon');
    };
    const entry = {pageId:page,schema:[],name:'Fictional tester',wechat:'FIXTURE',answers:{},reuse:false,hash:sha(randomBytes(32))};
    await assert.rejects(submit(entry), /ACCESS_DENIED/);
    await credential(keys.public);
    const registration = (await submit(entry)).rows[0].result.submissionId;
    const decision = { id:registration, actor:'verified-fixture-staff', status:'approved' };
    await assert.rejects(review(decision), /ACCESS_DENIED/);
    await credential(keys.staff);
    await assert.rejects(submit(entry), /ACCESS_DENIED/);
    await enabled('public',false);
    await credential(keys.public);
    await assert.rejects(submit(entry), /ACCESS_DENIED/);
    await credential(keys.staff);
    assert.equal((await review(decision)).rows[0].result.row.status,'approved');
    await enabled('staff',false);
    await assert.rejects(review(decision), /ACCESS_DENIED/);
    await enabled('public',true);
    await credential(keys.public);
    assert.ok((await submit({...entry,hash:sha(randomBytes(32))})).rows[0].result.submissionId);
    const grants = await db.query("SELECT has_table_privilege(current_user,'public.activity_registration_submissions','SELECT') AS submissions,has_table_privilege(current_user,'public.fixture_registration_credentials','SELECT') AS secrets");
    assert.deepEqual(grants.rows,[{submissions:false,secrets:false}]);
  } finally {
    await db.close();
  }
});
