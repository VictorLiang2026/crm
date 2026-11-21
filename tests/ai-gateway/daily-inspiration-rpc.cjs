'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');

const readMigration = name => fs.readFileSync(path.join(__dirname, '../../cloudbase/migrations', name + '.sql'), 'utf8');

test('daily inspiration RPC accepts scored imports, validates adjacent operations and rolls back safely', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.crm_access_members (uid text PRIMARY KEY, enabled boolean);
      INSERT INTO public.crm_access_members VALUES ('fixture',true);
      GRANT SELECT ON public.crm_access_members TO service_role;`);
    await db.exec(readMigration('20261120135100_daily_inspiration'));
    await db.exec(readMigration('20261120142200_daily_inspiration_acl_hardening'));
    await db.exec('ALTER TABLE public.daily_inspiration_quotes ADD COLUMN recommendation_score smallint CHECK (recommendation_score BETWEEN 0 AND 10)');
    await db.exec(readMigration('20261121190000_daily_inspiration_filter_rotation'));
    const definition = async () => (await db.query("SELECT pg_catalog.pg_get_functiondef('public.crm_daily_inspiration_v1(text,text,jsonb)'::regprocedure) AS ddl")).rows[0].ddl;
    const previous = await definition();
    const rpc = async (operation, payload, uid = 'fixture') =>
      (await db.query('SELECT public.crm_daily_inspiration_v1($1,$2,$3::jsonb) AS result', [operation,uid,JSON.stringify(payload)])).rows[0].result;

    const quote = {
      quoteZh:'倾听能帮助团队发现问题。',quoteEn:'Listening helps the team find problems.',
      theme:'team_leadership',sourceOrg:'Fixture',sourceTitle:'Test workbook',
      sourceUrl:'https://example.com/fixture',editorialRewrite:false,recommendationScore:9,
    };
    await db.exec('SET ROLE service_role');
    await assert.rejects(rpc('quote_save',quote), {code:'42883'});
    await db.exec('RESET ROLE');
    const fix = '20261121202000_daily_inspiration_rpc_validation';
    await db.exec(readMigration(fix));
    await db.exec('SET ROLE service_role');
    const saved = (await rpc('quote_save',quote)).quote;
    assert.equal(saved.recommendation_score,9);
    assert.equal((await rpc('quote_save',{...quote,id:String(saved.id),recommendationScore:0})).quote.recommendation_score,0);
    await assert.rejects(rpc('quote_save',{...quote,recommendationScore:11}), /DAILY_INSPIRATION_INVALID/);
    await assert.rejects(rpc('quote_save',{...quote,unexpected:true}), /DAILY_INSPIRATION_INVALID/);
    await assert.rejects(rpc('scores_save',{scores:[null,1]}), /DAILY_INSPIRATION_INVALID/);
    await assert.rejects(rpc('quote_save',quote,'not-a-member'), /DAILY_INSPIRATION_DENIED/);

    const {recommendationScore,...unscored} = quote;
    const legacy = (await rpc('quote_save',unscored)).quote;
    assert.equal(legacy.recommendation_score,null);
    assert.equal((await rpc('scores_save',{scores:[{id:String(legacy.id),recommendationScore:8}]})).updated,1);
    const periods = {timezone:'Asia/Shanghai',firstPeriodStart:'01:00',secondPeriodStart:'12:00'};
    assert.equal((await rpc('settings_save',periods)).settings.minRecommendationScore,0);
    assert.equal((await rpc('settings_save',{...periods,minRecommendationScore:8,allowRepeatBeforeAllUsed:false})).settings.minRecommendationScore,8);
    const slot = {localDate:'2026-11-21',segment:'first'};
    const shown = await rpc('select',{...slot,quoteId:String(legacy.id)});
    assert.equal(shown.quote.id,legacy.id);
    const candidate = shown.candidates[0];
    assert.ok(candidate);
    assert.equal((await rpc('replace',{...slot,expectedQuoteId:String(legacy.id),quoteId:String(candidate.id)})).quote.id,candidate.id);
    assert.equal((await rpc('quote_toggle',{id:String(saved.id),enabled:false})).quote.enabled,false);

    await db.exec('RESET ROLE');
    await db.exec(readMigration(fix+'.rollback'));
    assert.equal(await definition(),previous);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM public.daily_inspiration_quotes')).rows[0].total,7);
  } finally {
    await db.close();
  }
});
