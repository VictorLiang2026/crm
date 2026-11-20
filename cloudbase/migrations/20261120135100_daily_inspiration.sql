BEGIN;

CREATE TABLE public.daily_inspiration_quotes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_zh text NOT NULL CHECK (length(btrim(quote_zh)) BETWEEN 4 AND 300),
  quote_en text NOT NULL CHECK (length(btrim(quote_en)) BETWEEN 4 AND 500),
  theme text NOT NULL CHECK (theme IN ('team_leadership','business_development','customer_service','customer_trust','protection','long_term','team_growth')),
  source_org text NOT NULL CHECK (length(btrim(source_org)) BETWEEN 1 AND 120),
  source_title text NOT NULL CHECK (length(btrim(source_title)) BETWEEN 1 AND 240),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  editorial_rewrite boolean NOT NULL DEFAULT true,
  is_seed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_inspiration_quotes_enabled_idx ON public.daily_inspiration_quotes (enabled, id);
ALTER TABLE public.daily_inspiration_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_inspiration_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_inspiration_quotes_service_only ON public.daily_inspiration_quotes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_inspiration_quotes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.daily_inspiration_quotes_id_seq TO service_role;

CREATE TABLE public.daily_inspiration_settings (
  uid text PRIMARY KEY CHECK (length(btrim(uid)) BETWEEN 1 AND 128),
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  first_period_start time NOT NULL DEFAULT time '01:00',
  second_period_start time NOT NULL DEFAULT time '12:00',
  pending_timezone text,
  pending_first_period_start time,
  pending_second_period_start time,
  effective_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (first_period_start < second_period_start)
);
ALTER TABLE public.daily_inspiration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_inspiration_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_inspiration_settings_service_only ON public.daily_inspiration_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_inspiration_settings TO service_role;

CREATE TABLE public.daily_inspiration_slots (
  uid text NOT NULL CHECK (length(btrim(uid)) BETWEEN 1 AND 128),
  local_date date NOT NULL,
  segment text NOT NULL CHECK (segment IN ('first','second')),
  quote_id bigint NOT NULL REFERENCES public.daily_inspiration_quotes(id) ON DELETE RESTRICT,
  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, local_date, segment)
);
CREATE INDEX daily_inspiration_slots_quote_idx ON public.daily_inspiration_slots (quote_id, local_date DESC);
ALTER TABLE public.daily_inspiration_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_inspiration_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_inspiration_slots_service_only ON public.daily_inspiration_slots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_inspiration_slots TO service_role;

CREATE TABLE public.daily_inspiration_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uid text NOT NULL CHECK (length(btrim(uid)) BETWEEN 1 AND 128),
  local_date date NOT NULL,
  segment text NOT NULL CHECK (segment IN ('first','second')),
  quote_id bigint NOT NULL REFERENCES public.daily_inspiration_quotes(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('shown','replaced')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_inspiration_history_user_time_idx ON public.daily_inspiration_history (uid, created_at DESC);
ALTER TABLE public.daily_inspiration_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_inspiration_history FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_inspiration_history_service_only ON public.daily_inspiration_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_inspiration_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.daily_inspiration_history_id_seq TO service_role;

INSERT INTO public.daily_inspiration_quotes
  (quote_zh, quote_en, theme, source_org, source_title, source_url, editorial_rewrite, is_seed, created_by, updated_by)
VALUES
  ('先理解客户真正关心的事，信任才有机会建立。',
   'Start by understanding what matters to the client; trust has room to grow from there.',
   'customer_trust', 'LIMRA', 'Trustworthy Selling: Professional Catalog',
   'https://www.limra.com/siteassets/solutions-and-services/global-solutions/learning--development/ltsicatalog.pdf', true, true, 'system', 'system'),
  ('好的保障建议从真实需要出发，而不是从产品开始。',
   'Strong protection advice starts with a real need, not with a product.',
   'protection', 'LIMRA / BCG', 'Extending the Life Insurance Value Proposition',
   'https://www.limra.com/siteassets/research/research-abstracts/2020/extending-the-life-insurance-value-proposition/2020_limra_bcg_prevention_strategy_report.pdf', true, true, 'system', 'system'),
  ('每一次可靠的服务，都是长期客户关系的一部分。',
   'Every dependable service moment becomes part of a lasting client relationship.',
   'long_term', 'LIMRA', 'Trustworthy Selling: Professional Catalog',
   'https://www.limra.com/siteassets/solutions-and-services/global-solutions/learning--development/ltsicatalog.pdf', true, true, 'system', 'system'),
  ('愿景要落到每日招聘、培养和经营管理的具体行动中。',
   'Turn a leadership vision into daily action in recruiting, development, and practice management.',
   'team_leadership', 'GAMA Global', 'Field Leadership Series and Leadership Management Program',
   'https://gamaglobal.org/training/', true, true, 'system', 'system'),
  ('持续培养新顾问，也是在建设团队长期成功的能力。',
   'Developing new advisors consistently builds the team’s capacity for long-term success.',
   'team_growth', 'GAMA Global', 'Emerging Leader Program',
   'https://gamaglobal.org/training/', true, true, 'system', 'system');

CREATE OR REPLACE FUNCTION public.crm_daily_inspiration_v1(
  p_operation text, p_actor_uid text, p_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE
  d jsonb := coalesce(p_data, '{}'::jsonb);
  qid bigint;
  qrow public.daily_inspiration_quotes%ROWTYPE;
  slotrow public.daily_inspiration_slots%ROWTYPE;
  v_date date;
  v_segment text;
  v_uid text := btrim(coalesce(p_actor_uid, ''));
  v_enabled boolean;
  v_timezone text;
  v_first time;
  v_second time;
  v_quote_zh text;
  v_quote_en text;
  v_theme text;
  v_source_org text;
  v_source_title text;
  v_source_url text;
  v_rewrite boolean;
BEGIN
  IF current_user <> 'service_role' OR v_uid = '' OR length(v_uid) > 128 OR jsonb_typeof(d) <> 'object' THEN
    RAISE EXCEPTION 'DAILY_INSPIRATION_DENIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_access_members m WHERE m.uid = v_uid AND m.enabled = true) THEN
    RAISE EXCEPTION 'DAILY_INSPIRATION_DENIED';
  END IF;
  DELETE FROM public.daily_inspiration_history WHERE created_at < now() - interval '90 days';

  INSERT INTO public.daily_inspiration_settings(uid) VALUES (v_uid) ON CONFLICT (uid) DO NOTHING;
  UPDATE public.daily_inspiration_settings SET
    timezone=coalesce(pending_timezone,timezone),
    first_period_start=coalesce(pending_first_period_start,first_period_start),
    second_period_start=coalesce(pending_second_period_start,second_period_start),
    pending_timezone=NULL,pending_first_period_start=NULL,pending_second_period_start=NULL,effective_date=NULL,
    updated_at=now()
    WHERE uid=v_uid AND effective_date <= (now() AT TIME ZONE timezone)::date;
  SELECT timezone, first_period_start, second_period_start INTO v_timezone, v_first, v_second
    FROM public.daily_inspiration_settings WHERE uid = v_uid;

  IF p_operation = 'library_list' THEN
    RETURN jsonb_build_object('settings', jsonb_build_object('timezone', v_timezone,
      'firstPeriodStart', to_char(v_first, 'HH24:MI'), 'secondPeriodStart', to_char(v_second, 'HH24:MI'),
      'pendingTimezone',(SELECT pending_timezone FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'pendingFirstPeriodStart',(SELECT to_char(pending_first_period_start,'HH24:MI') FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'pendingSecondPeriodStart',(SELECT to_char(pending_second_period_start,'HH24:MI') FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'effectiveDate',(SELECT effective_date FROM public.daily_inspiration_settings WHERE uid=v_uid)),
      'quotes', coalesce((SELECT jsonb_agg(to_jsonb(q) - 'created_by' - 'updated_by' - 'is_seed' ORDER BY q.updated_at DESC, q.id DESC)
        FROM public.daily_inspiration_quotes q), '[]'::jsonb));
  ELSIF p_operation = 'quote_save' THEN
    IF jsonb_object_length(d) <> (CASE WHEN d ? 'id' THEN 8 ELSE 7 END)
      OR jsonb_typeof(d->'quoteZh') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'quoteEn') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'theme') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'sourceOrg') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'sourceTitle') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'sourceUrl') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'editorialRewrite') IS DISTINCT FROM 'boolean'
      OR d->>'theme' NOT IN ('team_leadership','business_development','customer_service','customer_trust','protection','long_term','team_growth')
      OR length(btrim(d->>'quoteZh')) NOT BETWEEN 4 AND 300 OR length(btrim(d->>'quoteEn')) NOT BETWEEN 4 AND 500
      OR length(btrim(d->>'sourceOrg')) NOT BETWEEN 1 AND 120 OR length(btrim(d->>'sourceTitle')) NOT BETWEEN 1 AND 240
      OR d->>'sourceUrl' !~ '^https://'
      OR (d ? 'id' AND (d->>'id') !~ '^[1-9][0-9]{0,17}$') THEN
      RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
    END IF;
    IF d ? 'id' THEN
      UPDATE public.daily_inspiration_quotes SET quote_zh=btrim(d->>'quoteZh'), quote_en=btrim(d->>'quoteEn'),
        theme=d->>'theme', source_org=btrim(d->>'sourceOrg'), source_title=btrim(d->>'sourceTitle'),
        source_url=d->>'sourceUrl', editorial_rewrite=(d->>'editorialRewrite')::boolean,
        updated_by=v_uid, updated_at=now() WHERE id=(d->>'id')::bigint RETURNING id INTO qid;
    ELSE
      INSERT INTO public.daily_inspiration_quotes(quote_zh,quote_en,theme,source_org,source_title,source_url,
        editorial_rewrite,created_by,updated_by)
      VALUES (btrim(d->>'quoteZh'),btrim(d->>'quoteEn'),d->>'theme',btrim(d->>'sourceOrg'),
        btrim(d->>'sourceTitle'),d->>'sourceUrl',(d->>'editorialRewrite')::boolean,v_uid,v_uid) RETURNING id INTO qid;
    END IF;
    IF qid IS NULL THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_FOUND'; END IF;
    SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=qid;
    RETURN jsonb_build_object('quote', to_jsonb(qrow) - 'created_by' - 'updated_by' - 'is_seed');
  ELSIF p_operation = 'quote_toggle' THEN
    IF jsonb_object_length(d) <> 2 OR (d->>'id') !~ '^[1-9][0-9]{0,17}$' OR jsonb_typeof(d->'enabled') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
    END IF;
    UPDATE public.daily_inspiration_quotes SET enabled=(d->>'enabled')::boolean, updated_by=v_uid, updated_at=now()
      WHERE id=(d->>'id')::bigint RETURNING * INTO qrow;
    IF qrow.id IS NULL THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('quote', to_jsonb(qrow) - 'created_by' - 'updated_by' - 'is_seed');
  ELSIF p_operation = 'settings_save' THEN
    IF jsonb_object_length(d) <> 3 OR jsonb_typeof(d->'timezone') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'firstPeriodStart') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'secondPeriodStart') IS DISTINCT FROM 'string'
      OR d->>'firstPeriodStart' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR d->>'secondPeriodStart' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR d->>'firstPeriodStart' >= d->>'secondPeriodStart'
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=d->>'timezone') THEN
      RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
    END IF;
    INSERT INTO public.daily_inspiration_settings(uid,timezone,pending_timezone,pending_first_period_start,pending_second_period_start,effective_date,updated_at)
      VALUES(v_uid,v_timezone,d->>'timezone',(d->>'firstPeriodStart')::time,(d->>'secondPeriodStart')::time,
        (now() AT TIME ZONE v_timezone)::date+1,now())
      ON CONFLICT(uid) DO UPDATE SET
        pending_timezone=CASE WHEN excluded.pending_timezone IS DISTINCT FROM public.daily_inspiration_settings.timezone THEN excluded.pending_timezone ELSE NULL END,
        pending_first_period_start=CASE WHEN excluded.pending_first_period_start IS DISTINCT FROM public.daily_inspiration_settings.first_period_start THEN excluded.pending_first_period_start ELSE NULL END,
        pending_second_period_start=CASE WHEN excluded.pending_second_period_start IS DISTINCT FROM public.daily_inspiration_settings.second_period_start THEN excluded.pending_second_period_start ELSE NULL END,
        effective_date=CASE WHEN excluded.pending_timezone IS NOT NULL OR excluded.pending_first_period_start IS NOT NULL OR excluded.pending_second_period_start IS NOT NULL
          THEN (now() AT TIME ZONE public.daily_inspiration_settings.timezone)::date+1 ELSE NULL END,updated_at=now();
    RETURN jsonb_build_object('settings', jsonb_build_object('timezone',v_timezone,
      'firstPeriodStart',to_char(v_first,'HH24:MI'),'secondPeriodStart',to_char(v_second,'HH24:MI'),
      'pendingTimezone',(SELECT pending_timezone FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'pendingFirstPeriodStart',(SELECT to_char(pending_first_period_start,'HH24:MI') FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'pendingSecondPeriodStart',(SELECT to_char(pending_second_period_start,'HH24:MI') FROM public.daily_inspiration_settings WHERE uid=v_uid),
      'effectiveDate',(SELECT effective_date FROM public.daily_inspiration_settings WHERE uid=v_uid)));
  ELSIF p_operation IN ('current','select','replace') THEN
    IF jsonb_typeof(d->'localDate') IS DISTINCT FROM 'string' OR (d->>'localDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(d->'segment') IS DISTINCT FROM 'string' OR d->>'segment' NOT IN ('first','second') THEN
      RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
    END IF;
    v_date := (d->>'localDate')::date; v_segment := d->>'segment';
    IF p_operation = 'current' THEN
      SELECT * INTO slotrow FROM public.daily_inspiration_slots
        WHERE uid=v_uid AND local_date=v_date AND segment=v_segment;
      IF slotrow.quote_id IS NOT NULL THEN
        SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=slotrow.quote_id AND enabled=true;
      END IF;
    ELSIF p_operation = 'select' THEN
      IF jsonb_object_length(d) <> 3 OR (d->>'quoteId') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID'; END IF;
      qid := (d->>'quoteId')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes WHERE id=qid AND enabled=true) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_AVAILABLE'; END IF;
      INSERT INTO public.daily_inspiration_slots(uid,local_date,segment,quote_id) VALUES(v_uid,v_date,v_segment,qid)
        ON CONFLICT(uid,local_date,segment) DO UPDATE SET quote_id=excluded.quote_id,selected_at=now(),updated_at=now()
        WHERE NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes existing
          WHERE existing.id=public.daily_inspiration_slots.quote_id AND existing.enabled=true);
      SELECT * INTO slotrow FROM public.daily_inspiration_slots WHERE uid=v_uid AND local_date=v_date AND segment=v_segment FOR UPDATE;
      SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=slotrow.quote_id AND enabled=true;
      IF slotrow.quote_id=qid AND NOT EXISTS (SELECT 1 FROM public.daily_inspiration_history WHERE uid=v_uid AND local_date=v_date AND segment=v_segment AND event_type='shown' AND quote_id=qid) THEN
        INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type) VALUES(v_uid,v_date,v_segment,qid,'shown');
      END IF;
    ELSE
      IF jsonb_object_length(d) <> 4 OR (d->>'quoteId') !~ '^[1-9][0-9]{0,17}$'
        OR (d->>'expectedQuoteId') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID'; END IF;
      qid := (d->>'quoteId')::bigint;
      SELECT * INTO slotrow FROM public.daily_inspiration_slots WHERE uid=v_uid AND local_date=v_date AND segment=v_segment FOR UPDATE;
      IF slotrow.quote_id IS NULL OR slotrow.quote_id <> (d->>'expectedQuoteId')::bigint OR slotrow.quote_id=qid THEN
        RAISE EXCEPTION 'DAILY_INSPIRATION_STALE';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes WHERE id=qid AND enabled=true) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_AVAILABLE'; END IF;
      INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type)
        VALUES(v_uid,v_date,v_segment,slotrow.quote_id,'replaced');
      UPDATE public.daily_inspiration_slots SET quote_id=qid,selected_at=now(),updated_at=now()
        WHERE uid=v_uid AND local_date=v_date AND segment=v_segment;
      INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type)
        VALUES(v_uid,v_date,v_segment,qid,'shown');
      SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=qid;
    END IF;
    RETURN jsonb_build_object('settings',jsonb_build_object('timezone',v_timezone,
      'firstPeriodStart',to_char(v_first,'HH24:MI'),'secondPeriodStart',to_char(v_second,'HH24:MI')),
      'quote',CASE WHEN qrow.id IS NULL THEN NULL ELSE to_jsonb(qrow)-'created_by'-'updated_by'-'is_seed' END,
      'slot',CASE WHEN slotrow.quote_id IS NULL THEN NULL ELSE jsonb_build_object('quoteId',slotrow.quote_id,'selectedAt',slotrow.selected_at) END,
      'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',q.id,'quoteZh',q.quote_zh,'quoteEn',q.quote_en,
        'theme',q.theme,'sourceOrg',q.source_org,'sourceTitle',q.source_title,'sourceUrl',q.source_url,
        'lastShownAt',(SELECT max(h.created_at) FROM public.daily_inspiration_history h WHERE h.uid=v_uid AND h.quote_id=q.id AND h.event_type='shown'),
        'lastReplacedAt',(SELECT max(h.created_at) FROM public.daily_inspiration_history h WHERE h.uid=v_uid AND h.quote_id=q.id AND h.event_type='replaced')
        ) ORDER BY q.id) FROM public.daily_inspiration_quotes q WHERE q.enabled=true), '[]'::jsonb));
  ELSE
    RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_daily_inspiration_v1(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_daily_inspiration_v1(text,text,jsonb) TO service_role;
COMMIT;
