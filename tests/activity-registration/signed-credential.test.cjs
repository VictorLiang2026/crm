'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const pgliteModule = process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = require(pgliteModule);
const { pgcrypto } = require(path.join(path.dirname(require.resolve(pgliteModule)), 'contrib/pgcrypto.cjs'));

// This alternative runs only in an ephemeral database. No extension is installed
// on the CRM environment. Both ends sign exactly the same serialized message.
test('database verifies scoped HMAC proofs, consumes each nonce once and supports independent revocation', async () => {
  const db = new PGlite({extensions:{pgcrypto}});
  const keys = {public:crypto.randomBytes(32),staff:crypto.randomBytes(32)};
  try {
    const migrationFile = path.resolve(__dirname,'../../cloudbase/migrations/20261111234500_activity_registration_crypto');
    const read = suffix => require('node:fs').readFileSync(migrationFile+suffix+'.sql','utf8');
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
    await db.exec(read(''));
    const acl = await db.query("SELECT has_function_privilege('anon','public.hmac(bytea,bytea,text)','EXECUTE') AS anon, has_function_privilege('authenticated','public.hmac(bytea,bytea,text)','EXECUTE') AS authenticated");
    assert.deepEqual(acl.rows,[{anon:false,authenticated:false}]);
    await db.exec(`
      CREATE TABLE public.fixture_signers(scope text PRIMARY KEY, secret bytea NOT NULL, enabled boolean NOT NULL);
      CREATE TABLE public.fixture_used_nonces(scope text, nonce uuid, PRIMARY KEY(scope,nonce));
      CREATE FUNCTION public.fixture_verify(expected_scope text,expected_action text,envelope text,signature bytea)
      RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      DECLARE p jsonb := envelope::jsonb; verifier bytea; claimed_at bigint; n integer;
      BEGIN
        SELECT secret INTO verifier FROM public.fixture_signers WHERE scope=expected_scope AND enabled FOR SHARE;
        IF verifier IS NULL OR public.hmac(convert_to(envelope,'UTF8'),verifier,'sha256') IS DISTINCT FROM signature
          OR p->>'scope' IS DISTINCT FROM expected_scope OR p->>'action' IS DISTINCT FROM expected_action
          OR p->>'aud' IS DISTINCT FROM 'registration-fixture' OR p->>'nonce' IS NULL THEN RETURN false; END IF;
        claimed_at := (p->>'issued')::bigint;
        IF claimed_at IS NULL OR abs(extract(epoch from clock_timestamp())-claimed_at)>30 THEN RETURN false; END IF;
        INSERT INTO public.fixture_used_nonces VALUES(expected_scope,(p->>'nonce')::uuid) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS n=ROW_COUNT;
        RETURN n=1;
      END $$;
      REVOKE ALL ON FUNCTION public.fixture_verify(text,text,text,bytea) FROM PUBLIC;
    `);
    for (const [scope,key] of Object.entries(keys)) {
      await db.query('INSERT INTO public.fixture_signers VALUES($1,$2,true)',[scope,key]);
    }
    function sign(scope,action,issued=Math.floor(Date.now()/1000)) {
      const envelope=JSON.stringify({aud:'registration-fixture',scope,action,issued,nonce:crypto.randomUUID(),data:{fictionalActivity:1}});
      const signature=crypto.createHmac('sha256',keys[scope]).update(envelope).digest('hex');
      return {envelope,signature};
    }
    async function verify(scope,action,{envelope,signature}) {
      const row=await db.query("SELECT public.fixture_verify($1,$2,$3,decode($4,'hex')) AS ok",[scope,action,envelope,signature]);
      return row.rows[0].ok;
    }
    const registration=sign('public','submit');
    assert.equal(await verify('staff','review',registration),false);
    assert.equal(await verify('public','submit',{...registration,envelope:registration.envelope.replace('Activity','Event')}),false);
    assert.equal(await verify('public','submit',registration),true);
    assert.equal(await verify('public','submit',registration),false);
    assert.equal(await verify('staff','review',sign('staff','review',Math.floor(Date.now()/1000)-120)),false);
    await db.query("UPDATE public.fixture_signers SET enabled=false WHERE scope='public'");
    assert.equal(await verify('public','submit',sign('public','submit')),false);
    assert.equal(await verify('staff','review',sign('staff','review')),true);
    for (const key of Object.values(keys)) {
      assert.ok(!JSON.stringify(registration).includes(key.toString('hex')));
      assert.ok(!JSON.stringify(registration).includes(key.toString('base64url')));
    }
    await db.exec('DROP FUNCTION public.fixture_verify(text,text,text,bytea)');
    await db.exec(read('.rollback'));
    assert.equal((await db.query("SELECT to_regprocedure('public.hmac(bytea,bytea,text)') IS NULL AS removed")).rows[0].removed,true);
  } finally { await db.close(); }
});
