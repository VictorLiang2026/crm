BEGIN;
SET LOCAL lock_timeout='5s';

ALTER TABLE public.interactions ADD COLUMN next_followup_date date;

DO $interaction_dates$
DECLARE v_oid oid; v_def text; v_old text; v_new text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.crm_person_interaction_v1(text,text,bigint,jsonb)'::regprocedure)
      IS DISTINCT FROM 'b854f2d54586dadc7944e44abc908e0e' THEN
    RAISE EXCEPTION 'Interaction RPC definition changed';
  END IF;
  SELECT oid INTO v_oid FROM pg_catalog.pg_proc WHERE oid='public.crm_person_interaction_v1(text,text,bigint,jsonb)'::regprocedure;
  v_def:=pg_get_functiondef(v_oid);
  v_old:='DELETE FROM public.followups WHERE "Id"=f."Id";'||E'\n      RETURN jsonb_build_object(''ok'',true);';
  v_new:='DELETE FROM public.followups WHERE "Id"=f."Id";'||E'\n      UPDATE public.persons SET updated_at=clock_timestamp() WHERE id=p_person_id;'||E'\n      RETURN jsonb_build_object(''ok'',true);';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Interaction delete block not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='moment := (p_data->>''interaction_at'')::timestamptz;'||E'\n  date_precision := COALESCE(p_data->>''time_precision'',''instant'');';
  v_new:='IF p_data ? ''interaction_date'' THEN'||E'\n    IF p_data->>''interaction_date'' IS NOT NULL AND p_data->>''interaction_date'' !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' THEN RAISE EXCEPTION ''INTERACTION_INVALID_TIME''; END IF;'||E'\n    moment := CASE WHEN p_data->>''interaction_date'' IS NULL THEN NULL ELSE ((p_data->>''interaction_date'')::date::timestamp AT TIME ZONE ''Asia/Shanghai'') END;'||E'\n    date_precision := CASE WHEN moment IS NULL THEN COALESCE(p_data->>''time_precision'',''unknown'') ELSE ''day'' END;'||E'\n  ELSE'||E'\n    moment := (p_data->>''interaction_at'')::timestamptz;'||E'\n    date_precision := COALESCE(p_data->>''time_precision'',''instant'');'||E'\n  END IF;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Interaction date parser not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='INSERT INTO public.followups(customer_id,customer_name,followup_date,interaction_summary,followup_notes,created_at)'||E'\n        VALUES(c."Id",person_name,(moment AT TIME ZONE ''Asia/Shanghai'')::date,p_data->>''summary'',p_data->>''raw_note'',clock_timestamp()) RETURNING * INTO f;';
  v_new:='INSERT INTO public.followups(customer_id,customer_name,followup_date,interaction_summary,followup_notes,created_at,next_followup_date)'||E'\n        VALUES(c."Id",person_name,(moment AT TIME ZONE ''Asia/Shanghai'')::date,p_data->>''summary'',p_data->>''raw_note'',clock_timestamp(),CASE WHEN p_data ? ''next_followup_date'' THEN (p_data->>''next_followup_date'')::date END) RETURNING * INTO f;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Follow-up insert block not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,source_type,created_by_uid)'||E'\n        VALUES(p_person_id,p_data->>''interaction_type'',moment,p_data->>''summary'',''manual'',p_actor_uid) RETURNING id INTO iid;';
  v_new:='INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,source_type,created_by_uid,next_followup_date)'||E'\n        VALUES(p_person_id,p_data->>''interaction_type'',moment,p_data->>''summary'',''manual'',p_actor_uid,CASE WHEN p_data ? ''next_followup_date'' THEN (p_data->>''next_followup_date'')::date END) RETURNING id INTO iid;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Manual interaction insert block not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='UPDATE public.followups SET next_followup_date=(p_data->>''next_followup_date'')::date,';
  v_new:='UPDATE public.followups SET next_followup_date=CASE WHEN p_data ? ''next_followup_date'' THEN (p_data->>''next_followup_date'')::date ELSE next_followup_date END,';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Follow-up next date update not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='UPDATE public.interactions SET interaction_type=p_data->>''interaction_type'',interaction_at=moment,time_precision=date_precision,';
  v_new:='UPDATE public.interactions SET interaction_type=p_data->>''interaction_type'',interaction_at=moment,time_precision=date_precision,'||E'\n    next_followup_date=CASE WHEN p_data ? ''next_followup_date'' THEN (p_data->>''next_followup_date'')::date ELSE next_followup_date END,';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Manual interaction next date update not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='WHERE id=iid RETURNING * INTO i;'||E'\n  RETURN jsonb_build_object(''ok'',true,''interaction'',to_jsonb(i));';
  v_new:='WHERE id=iid RETURNING * INTO i;'||E'\n  UPDATE public.persons SET updated_at=clock_timestamp() WHERE id=p_person_id;'||E'\n  RETURN jsonb_build_object(''ok'',true,''interaction'',to_jsonb(i));';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Interaction save completion not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);
  EXECUTE v_def;
END
$interaction_dates$;

DO $directory_dates$
DECLARE v_name text; v_sig text; v_oid oid; v_def text; v_old text; v_new text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['person_directory_page_v1','person_directory_filtered_page_v1'] LOOP
    v_sig:=CASE WHEN v_name='person_directory_page_v1'
      THEN 'public.person_directory_page_v1(integer,integer,text,text,text)'
      ELSE 'public.person_directory_filtered_page_v1(integer,integer,text,text,text,text[],text[],text[],text[])' END;
    SELECT oid INTO v_oid FROM pg_catalog.pg_proc WHERE oid=v_sig::regprocedure;
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Directory RPC missing: %',v_name; END IF;
    IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=v_oid) IS DISTINCT FROM
       (CASE WHEN v_name='person_directory_page_v1' THEN '4c91f63d77285aef52db34f223dada69' ELSE '1dd354f40716ef1f92729f7b0af1a21a' END) THEN
      RAISE EXCEPTION 'Directory definition changed: %',v_name;
    END IF;
    v_def:=pg_get_functiondef(v_oid);
    v_old:='          SELECT rf.followup_date, rf.next_followup_date AS next_date'||E'\n          FROM public.recruit_followups rf'||E'\n          WHERE rc.id IS NOT NULL AND rf.candidate_id = rc.id AND rf.deleted_at IS NULL';
    v_new:=v_old||E'\n          UNION ALL'||E'\n          SELECT (mi.interaction_at AT TIME ZONE ''Asia/Shanghai'')::date, mi.next_followup_date'||E'\n          FROM public.interactions mi'||E'\n          WHERE mi.person_id=p.id AND mi.source_type=''manual'' AND mi.deleted_at IS NULL';
    IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Directory follow-up union not found: %',v_name; END IF;
    v_def:=replace(v_def,v_old,v_new);
    EXECUTE v_def;
  END LOOP;
END
$directory_dates$;

DO $worklist_dates$
DECLARE v_oid oid; v_def text; v_old text; v_new text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.person_customer_worklist_v1(jsonb)'::regprocedure)
      IS DISTINCT FROM '9b4ac08e6c8bfbdc9a02cc9366fe1d79' THEN RAISE EXCEPTION 'Customer worklist definition changed'; END IF;
  SELECT oid INTO v_oid FROM pg_catalog.pg_proc WHERE oid='public.person_customer_worklist_v1(jsonb)'::regprocedure;
  v_def:=pg_get_functiondef(v_oid);
  v_old:='SELECT x.followup_date,x.next_followup_date FROM public.followups x'||E'\n        WHERE x.customer_id=c."Id" AND x.deleted_at IS NULL'||E'\n        ORDER BY x.followup_date DESC NULLS LAST,x."Id" DESC LIMIT 1';
  v_new:='SELECT max(x.followup_date) AS followup_date,'||E'\n          min(x.next_followup_date) FILTER (WHERE x.next_followup_date >= CURRENT_DATE) AS next_followup_date'||E'\n        FROM ('||E'\n          SELECT x.followup_date,x.next_followup_date FROM public.followups x'||E'\n          WHERE x.customer_id=c."Id" AND x.deleted_at IS NULL'||E'\n          UNION ALL'||E'\n          SELECT x.followup_date,x.next_followup_date FROM public.recruit_followups x'||E'\n          WHERE rc.id IS NOT NULL AND x.candidate_id=rc.id AND x.deleted_at IS NULL'||E'\n          UNION ALL'||E'\n          SELECT (mi.interaction_at AT TIME ZONE ''Asia/Shanghai'')::date,mi.next_followup_date FROM public.interactions mi'||E'\n          WHERE mi.person_id=p.id AND mi.source_type=''manual'' AND mi.deleted_at IS NULL'||E'\n        ) x';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'Customer worklist follow-up query not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);
  EXECUTE v_def;
END
$worklist_dates$;

NOTIFY pgrst,'reload schema';
COMMIT;
