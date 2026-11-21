BEGIN;
DO $migration$
DECLARE
  target constant regprocedure := 'public.crm_daily_inspiration_v1(text,text,jsonb)'::regprocedure;
  body_hash text;
  ddl text := pg_catalog.pg_get_functiondef(target);
  branch_start int := strpos(ddl, '  ELSIF p_operation IN (''current'',''select'',''replace'') THEN');
  branch_end int;
  replacement constant text := $branch$
  ELSIF p_operation IN ('current','select','replace') THEN
    IF jsonb_typeof(d->'localDate') IS DISTINCT FROM 'string' OR (d->>'localDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(d->'segment') IS DISTINCT FROM 'string' OR d->>'segment' NOT IN ('first','second') THEN
      RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID';
    END IF;
    v_date := (d->>'localDate')::date; v_segment := d->>'segment';
    SELECT count(*) INTO v_pool_count FROM public.daily_inspiration_quotes q WHERE q.enabled=true AND q.recommendation_score IS NOT NULL AND q.recommendation_score>=v_min_score;
    SELECT count(DISTINCT u.quote_id) INTO v_used_count FROM public.daily_inspiration_rotation_used u JOIN public.daily_inspiration_quotes q ON q.id=u.quote_id WHERE u.uid=v_uid AND q.enabled=true AND q.recommendation_score IS NOT NULL AND q.recommendation_score>=v_min_score;
    IF v_pool_count>0 AND v_used_count>=v_pool_count THEN DELETE FROM public.daily_inspiration_rotation_used WHERE uid=v_uid; END IF;
    IF p_operation = 'current' THEN
      SELECT * INTO slotrow FROM public.daily_inspiration_slots
        WHERE uid=v_uid AND local_date=v_date AND segment=v_segment;
      IF slotrow.quote_id IS NOT NULL THEN
        SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=slotrow.quote_id AND enabled=true AND recommendation_score IS NOT NULL AND recommendation_score>=v_min_score;
        IF qrow.id IS NOT NULL THEN INSERT INTO public.daily_inspiration_rotation_used(uid,quote_id) VALUES(v_uid,qrow.id) ON CONFLICT DO NOTHING; END IF;
      END IF;
    ELSIF p_operation = 'select' THEN
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(d)) <> 3 OR (d->>'quoteId') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID'; END IF;
      qid := (d->>'quoteId')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes WHERE id=qid AND enabled=true AND recommendation_score IS NOT NULL AND recommendation_score>=v_min_score) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_AVAILABLE'; END IF;
      IF NOT v_allow_repeat AND EXISTS (SELECT 1 FROM public.daily_inspiration_rotation_used WHERE uid=v_uid AND quote_id=qid) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_ROTATION_USED'; END IF;
      INSERT INTO public.daily_inspiration_slots(uid,local_date,segment,quote_id) VALUES(v_uid,v_date,v_segment,qid)
        ON CONFLICT(uid,local_date,segment) DO UPDATE SET quote_id=excluded.quote_id,selected_at=now(),updated_at=now()
        WHERE NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes existing
          WHERE existing.id=public.daily_inspiration_slots.quote_id AND existing.enabled=true AND existing.recommendation_score IS NOT NULL AND existing.recommendation_score>=v_min_score);
      SELECT * INTO slotrow FROM public.daily_inspiration_slots WHERE uid=v_uid AND local_date=v_date AND segment=v_segment FOR UPDATE;
      SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=slotrow.quote_id AND enabled=true;
      IF slotrow.quote_id=qid AND NOT EXISTS (SELECT 1 FROM public.daily_inspiration_history WHERE uid=v_uid AND local_date=v_date AND segment=v_segment AND event_type='shown' AND quote_id=qid) THEN
        INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type) VALUES(v_uid,v_date,v_segment,qid,'shown');
      END IF;
      IF slotrow.quote_id=qid THEN INSERT INTO public.daily_inspiration_rotation_used(uid,quote_id) VALUES(v_uid,qid) ON CONFLICT DO NOTHING; END IF;
    ELSE
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(d)) <> 4 OR (d->>'quoteId') !~ '^[1-9][0-9]{0,17}$'
        OR (d->>'expectedQuoteId') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'DAILY_INSPIRATION_INVALID'; END IF;
      qid := (d->>'quoteId')::bigint;
      SELECT * INTO slotrow FROM public.daily_inspiration_slots WHERE uid=v_uid AND local_date=v_date AND segment=v_segment FOR UPDATE;
      IF slotrow.quote_id IS NULL OR slotrow.quote_id <> (d->>'expectedQuoteId')::bigint OR slotrow.quote_id=qid THEN
        RAISE EXCEPTION 'DAILY_INSPIRATION_STALE';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.daily_inspiration_quotes WHERE id=qid AND enabled=true AND recommendation_score IS NOT NULL AND recommendation_score>=v_min_score) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_NOT_AVAILABLE'; END IF;
      IF NOT v_allow_repeat AND EXISTS (SELECT 1 FROM public.daily_inspiration_rotation_used WHERE uid=v_uid AND quote_id=qid) THEN RAISE EXCEPTION 'DAILY_INSPIRATION_ROTATION_USED'; END IF;
      INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type)
        VALUES(v_uid,v_date,v_segment,slotrow.quote_id,'replaced');
      UPDATE public.daily_inspiration_slots SET quote_id=qid,selected_at=now(),updated_at=now()
        WHERE uid=v_uid AND local_date=v_date AND segment=v_segment;
      INSERT INTO public.daily_inspiration_history(uid,local_date,segment,quote_id,event_type)
        VALUES(v_uid,v_date,v_segment,qid,'shown');
      INSERT INTO public.daily_inspiration_rotation_used(uid,quote_id) VALUES(v_uid,qid) ON CONFLICT DO NOTHING;
      SELECT * INTO qrow FROM public.daily_inspiration_quotes WHERE id=qid;
    END IF;
    RETURN jsonb_build_object('settings',jsonb_build_object('timezone',v_timezone,
      'firstPeriodStart',to_char(v_first,'HH24:MI'),'secondPeriodStart',to_char(v_second,'HH24:MI'),
      'minRecommendationScore',v_min_score,'allowRepeatBeforeAllUsed',v_allow_repeat),
      'quote',CASE WHEN qrow.id IS NULL THEN NULL ELSE to_jsonb(qrow)-'created_by'-'updated_by'-'is_seed' END,
      'slot',CASE WHEN slotrow.quote_id IS NULL THEN NULL ELSE jsonb_build_object('quoteId',slotrow.quote_id,'selectedAt',slotrow.selected_at) END,
      'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',q.id,'quoteZh',q.quote_zh,'quoteEn',q.quote_en,
        'theme',q.theme,'sourceOrg',q.source_org,'sourceTitle',q.source_title,'sourceUrl',q.source_url,
        'lastShownAt',(SELECT max(h.created_at) FROM public.daily_inspiration_history h WHERE h.uid=v_uid AND h.quote_id=q.id AND h.event_type='shown'),
        'lastReplacedAt',(SELECT max(h.created_at) FROM public.daily_inspiration_history h WHERE h.uid=v_uid AND h.quote_id=q.id AND h.event_type='replaced'),
        'rotationUsed',EXISTS(SELECT 1 FROM public.daily_inspiration_rotation_used u WHERE u.uid=v_uid AND u.quote_id=q.id)
        ) ORDER BY q.id) FROM public.daily_inspiration_quotes q WHERE q.enabled=true AND q.recommendation_score IS NOT NULL AND q.recommendation_score>=v_min_score AND (v_allow_repeat OR NOT EXISTS(SELECT 1 FROM public.daily_inspiration_rotation_used u WHERE u.uid=v_uid AND u.quote_id=q.id))), '[]'::jsonb));
$branch$;
BEGIN
  SELECT pg_catalog.md5(prosrc) INTO body_hash FROM pg_catalog.pg_proc WHERE oid=target;
  branch_end := strpos(substring(ddl from branch_start), E'\n  ELSE\n    RAISE EXCEPTION ''DAILY_INSPIRATION_INVALID'';\n  END IF;\nEND;\n');
  IF body_hash IS DISTINCT FROM '0251726674e2b5cfbf5930f20027217b' OR branch_start<=0 OR branch_end<=0 THEN
    RAISE EXCEPTION 'Unexpected daily inspiration RPC definition';
  END IF;
  EXECUTE overlay(ddl placing trim(both E'\n' from replacement)
    from branch_start for branch_end-1);
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
