-- L07: bounded, actor-owned restore previews. Existing restore functions are unchanged.
CREATE TABLE public.crm_recycle_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  request_key uuid NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  plans jsonb NOT NULL,
  preview jsonb NOT NULL,
  result jsonb,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '15 minutes'),
  executed_at timestamptz,
  UNIQUE(actor_uid,request_key)
);
ALTER TABLE public.crm_recycle_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recycle_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recycle_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_recycle_commands TO service_role;
CREATE POLICY crm_recycle_commands_service_only ON public.crm_recycle_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.crm_recycle_batch_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog SET timezone='UTC' SET lock_timeout='3s'
AS $fn$
DECLARE
  v_cmd public.crm_recycle_commands%ROWTYPE;
  v_items jsonb; v_item jsonb; v_plan jsonb; v_saved jsonb; v_root jsonb;
  v_plans jsonb := '[]'; v_preview jsonb := '[]'; v_results jsonb := '[]';
  v_children jsonb; v_rows jsonb; v_counts jsonb; v_one jsonb; v_public jsonb;
  v_ids bigint[]; v_parents bigint[]; v_people bigint[]; v_cands bigint[];
  v_id bigint; v_kind text; v_table text; v_pk text; v_fk text; v_owner bigint[];
  v_root_table text; v_root_pk text; v_batch uuid; v_key uuid; v_preview_id uuid;
  v_person bigint; v_name text; v_parent bigint; v_n integer; v_total integer;
  v_code text; v_test boolean; v_test_batch text; v_state text; v_message text;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL
     OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Unauthorized recycle command' USING ERRCODE='42501';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('preview','get','execute')
     OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid recycle command';
  END IF;
  IF p_operation='preview' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>2 OR NOT (p_data ?& ARRAY['requestKey','items'])
       OR jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid recycle preview';
    END IF;
    v_key := (p_data->>'requestKey')::uuid;
    IF v_key IS NULL OR jsonb_array_length(p_data->'items') NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'Invalid recycle selection';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid recycle item'; END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(v_item))<>2 OR NOT (v_item ?& ARRAY['kind','id'])
        OR v_item->>'kind' IS NULL OR v_item->>'kind' NOT IN ('customer','recruit','person_recruit')
        OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'number'
        OR coalesce(v_item->>'id','') !~ '^[1-9][0-9]{0,15}$' THEN
        RAISE EXCEPTION 'Invalid recycle item';
      END IF;
      v_id := (v_item->>'id')::bigint;
      IF v_id>9007199254740991 OR (v_item->>'kind'='customer' AND v_id>2147483647) THEN
        RAISE EXCEPTION 'Invalid recycle ID';
      END IF;
    END LOOP;
    SELECT jsonb_agg(value ORDER BY value->>'kind',(value->>'id')::bigint) INTO v_items
      FROM jsonb_array_elements(p_data->'items');
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) a GROUP BY
       CASE WHEN a->>'kind'='customer' THEN 'customer' ELSE 'recruit' END,a->>'id' HAVING count(*)>1)
       OR (EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) a WHERE a->>'kind'='customer')
           AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) a WHERE a->>'kind'<>'customer')) THEN
      RAISE EXCEPTION 'Invalid mixed or duplicate recycle selection';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_uid||':'||v_key::text,0));
    SELECT * INTO v_cmd FROM public.crm_recycle_commands WHERE actor_uid=p_actor_uid AND request_key=v_key FOR UPDATE;
    IF FOUND THEN
      IF v_cmd.items IS DISTINCT FROM v_items THEN RAISE EXCEPTION 'Idempotency key selection changed'; END IF;
      RETURN jsonb_build_object('previewId',v_cmd.id,'status',v_cmd.status,'expiresAt',v_cmd.expires_at,
        'items',v_cmd.preview,'results',v_cmd.result);
    END IF;
  ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>1 OR NOT (p_data ? 'previewId') THEN
      RAISE EXCEPTION 'Invalid recycle receipt';
    END IF;
    v_preview_id := (p_data->>'previewId')::uuid;
    SELECT * INTO v_cmd FROM public.crm_recycle_commands WHERE id=v_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Preview not available' USING ERRCODE='42501'; END IF;
    IF p_operation='get' OR v_cmd.status='executed' THEN
      RETURN jsonb_build_object('previewId',v_cmd.id,'status',v_cmd.status,'expiresAt',v_cmd.expires_at,
        'items',v_cmd.preview,'results',v_cmd.result);
    END IF;
    IF v_cmd.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Preview expired; review again'; END IF;
    v_items := v_cmd.items;
  END IF;
  SELECT array_agg((a->>'id')::bigint) INTO v_ids FROM jsonb_array_elements(v_items) a;
  IF v_items->0->>'kind'='customer' THEN v_parents := v_ids;
  ELSE
    SELECT array_agg(DISTINCT customer_id),array_agg(DISTINCT person_id) FILTER(WHERE customer_id IS NULL)
      INTO v_parents,v_people FROM public.recruit_candidates WHERE id=ANY(v_ids);
  END IF;
  -- Match existing restore lock order: customers -> Person-only parents -> candidates.
  PERFORM "Id" FROM public.customers WHERE "Id"=ANY(v_parents) ORDER BY "Id" FOR UPDATE;
  PERFORM id FROM public.persons WHERE id=ANY(v_people) ORDER BY id FOR UPDATE;
  IF v_items->0->>'kind'='customer' THEN
    PERFORM id FROM public.recruit_candidates WHERE customer_id=ANY(v_ids) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM id FROM public.recruit_candidates WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
  END IF;
  v_test := EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_id := (v_item->>'id')::bigint; v_kind := v_item->>'kind';
    v_root := NULL; v_name := NULL; v_test_batch := NULL;
    v_children := '{}'; v_counts := '{}'; v_total := 0; v_code := 'READY'; v_saved := NULL;
    v_public := v_item;
    IF p_operation='execute' THEN
      SELECT value INTO v_saved FROM jsonb_array_elements(v_cmd.plans) a
        WHERE a->>'kind'=v_kind AND a->>'id'=v_id::text;
    END IF;
    BEGIN
      v_root_table := CASE WHEN v_kind='customer' THEN 'customers' ELSE 'recruit_candidates' END;
      v_root_pk := CASE WHEN v_kind='customer' THEN 'Id' ELSE 'id' END;
      IF v_kind='customer' THEN
        SELECT jsonb_build_object('id',"Id",'person_id',person_id,'customer_id',"Id",'deleted_at',deleted_at,
          'delete_batch_id',delete_batch_id,'updated_at',updated_at) INTO v_root FROM public.customers WHERE "Id"=v_id;
      ELSE
        SELECT jsonb_build_object('id',id,'person_id',person_id,'customer_id',customer_id,'deleted_at',deleted_at,
          'delete_batch_id',delete_batch_id,'updated_at',updated_at) INTO v_root FROM public.recruit_candidates WHERE id=v_id;
      END IF;
      IF v_root IS NULL THEN RAISE EXCEPTION 'NOT_AVAILABLE'; END IF;
      v_person := (v_root->>'person_id')::bigint; v_parent := (v_root->>'customer_id')::bigint;
      IF (v_kind='recruit' AND v_parent IS NULL) OR (v_kind='person_recruit' AND v_parent IS NOT NULL)
         OR (v_kind='recruit' AND NOT coalesce(v_parent=ANY(v_parents),false))
         OR (v_kind='person_recruit' AND NOT coalesce(v_person=ANY(v_people),false)) THEN
        RAISE EXCEPTION 'STALE_SCOPE';
      END IF;
      SELECT display_name INTO v_name FROM public.persons WHERE id=v_person;
      IF v_test THEN
        SELECT b.batch_key INTO v_test_batch FROM public.crm_test_batches b
          JOIN public.crm_test_records r ON r.batch_key=b.batch_key AND r.record_table=v_root_table AND r.record_id=v_id::text
          JOIN public.crm_test_records p ON p.batch_key=b.batch_key AND p.record_table='persons' AND p.record_id=v_person::text
          WHERE b.created_by_uid=p_actor_uid AND position('【系统测试·勿联系】' IN coalesce(v_name,''))>0 LIMIT 1;
        IF v_test_batch IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END IF;
      v_public := v_item || jsonb_build_object('name',coalesce(v_name,'#'||v_id),'batchId',v_root->'delete_batch_id');
      -- A blocked preview never becomes an executable grant when its prerequisites change.
      IF p_operation='execute' AND v_saved->>'code'<>'READY' THEN
        RAISE EXCEPTION '%',v_saved->>'code';
      END IF;
      IF v_root->>'deleted_at' IS NULL THEN RAISE EXCEPTION 'ALREADY_RESTORED'; END IF;
      IF v_kind='recruit' AND NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_parent AND deleted_at IS NULL)
        OR v_kind='person_recruit' AND NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_person AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'PARENT_DELETED';
      END IF;
      v_batch := (v_root->>'delete_batch_id')::uuid;
      v_cands := CASE WHEN v_kind='customer' THEN '{}'::bigint[] ELSE ARRAY[v_id] END;
      IF v_batch IS NOT NULL THEN
        FOREACH v_table IN ARRAY CASE WHEN v_kind='customer' THEN
          ARRAY['followups','gifts','photos','policy_review_reports','ocr_records','products','recruit_candidates','recruit_followups']
          ELSE ARRAY['recruit_followups'] END LOOP
          v_pk := CASE WHEN v_table IN ('followups','gifts') THEN 'Id' ELSE 'id' END;
          v_fk := CASE WHEN v_table='recruit_followups' THEN 'candidate_id' ELSE 'customer_id' END;
          v_owner := CASE WHEN v_table='recruit_followups' THEN v_cands ELSE ARRAY[v_id] END;
          -- Capture only restore membership, never file contents or notes. Bound work per root.
          EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]''::jsonb) FROM
            (SELECT %I AS id,%I AS owner_id,deleted_at,delete_batch_id%s FROM public.%I
             WHERE %I=ANY($1) AND deleted_at IS NOT NULL AND delete_batch_id=$2
             ORDER BY %I LIMIT 1001 FOR UPDATE) s',v_pk,v_fk,
             CASE WHEN v_table='recruit_candidates' THEN ',person_id' ELSE '' END,v_table,v_fk,v_pk)
            INTO v_rows USING v_owner,v_batch;
          v_total := v_total+jsonb_array_length(v_rows);
          IF v_total>1000 THEN RAISE EXCEPTION 'TOO_LARGE'; END IF;
          IF v_test AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE NOT EXISTS(
            SELECT 1 FROM public.crm_test_records r WHERE r.batch_key=v_test_batch
              AND r.record_table=v_table AND r.record_id=x->>'id')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
          IF v_test AND v_table='recruit_candidates' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) x
            WHERE NOT EXISTS(SELECT 1 FROM public.crm_test_records r JOIN public.persons p ON p.id::text=r.record_id
              WHERE r.batch_key=v_test_batch AND r.record_table='persons' AND r.record_id=x->>'person_id'
                AND position('【系统测试·勿联系】' IN p.display_name)>0)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
          v_children := jsonb_set(v_children,ARRAY[v_table],v_rows);
          v_counts := jsonb_set(v_counts,ARRAY[v_table],to_jsonb(jsonb_array_length(v_rows)));
          IF v_table='recruit_candidates' THEN
            SELECT coalesce(array_agg((x->>'id')::bigint),'{}') INTO v_cands FROM jsonb_array_elements(v_rows) x;
          END IF;
        END LOOP;
      END IF;
      v_plan := v_item || jsonb_build_object('code','READY','root',v_root,'children',v_children,'name',v_name);
      v_public := v_public || jsonb_build_object('counts',v_counts,'linkedCount',v_total);
      IF p_operation='execute' THEN
        IF v_plan IS DISTINCT FROM v_saved THEN RAISE EXCEPTION 'STALE_SCOPE'; END IF;
        FOR v_table,v_rows IN SELECT key,value FROM jsonb_each(v_children) ORDER BY key LOOP
          v_pk := CASE WHEN v_table IN ('followups','gifts') THEN 'Id' ELSE 'id' END;
          v_fk := CASE WHEN v_table='recruit_followups' THEN 'candidate_id' ELSE 'customer_id' END;
          -- The ID set is from the verified preview, not a broad batch UPDATE. Rows added after
          -- verification are excluded; changed membership/versions fail the whole item.
          EXECUTE format('UPDATE public.%I t SET deleted_at=NULL,delete_batch_id=NULL FROM
            jsonb_to_recordset($1) AS s(id bigint,owner_id bigint,deleted_at timestamptz,delete_batch_id uuid)
            WHERE t.%I=s.id AND t.%I=s.owner_id AND t.deleted_at=s.deleted_at AND t.delete_batch_id=s.delete_batch_id',v_table,v_pk,v_fk)
            USING v_rows;
          GET DIAGNOSTICS v_n=ROW_COUNT;
          IF v_n<>jsonb_array_length(v_rows) THEN RAISE EXCEPTION 'STALE_SCOPE'; END IF;
        END LOOP;
        EXECUTE format('UPDATE public.%I SET deleted_at=NULL,delete_batch_id=NULL WHERE %I=$1
          AND person_id=$2 AND deleted_at IS NOT NULL AND delete_batch_id IS NOT DISTINCT FROM $3',v_root_table,v_root_pk)
          USING v_id,v_person,v_batch;
        GET DIAGNOSTICS v_n=ROW_COUNT;
        IF v_n<>1 THEN RAISE EXCEPTION 'STALE_SCOPE'; END IF;
        v_code := 'RESTORED';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
      v_code := CASE WHEN v_message IN ('NOT_AVAILABLE','FORBIDDEN','STALE_SCOPE','ALREADY_RESTORED','PARENT_DELETED','TOO_LARGE')
        THEN v_message WHEN v_state IN ('55P03','40P01','40001') THEN 'BUSY' ELSE 'FAILED' END;
      -- No private SQL diagnostics or unverified names in a denied preview/receipt.
      IF v_code='FORBIDDEN' THEN v_public:=v_item; END IF;
      v_plan := v_item || jsonb_build_object('code',v_code);
    END;
    v_public := v_public || jsonb_build_object('code',v_code);
    IF p_operation='preview' THEN
      v_plans := v_plans || jsonb_build_array(v_plan);
      v_preview := v_preview || jsonb_build_array(v_public);
    ELSE v_results := v_results || jsonb_build_array(v_public); END IF;
  END LOOP;
  IF p_operation='preview' THEN
    INSERT INTO public.crm_recycle_commands(actor_uid,request_key,items,plans,preview)
      VALUES(p_actor_uid,v_key,v_items,v_plans,v_preview) RETURNING * INTO v_cmd;
  ELSE
    UPDATE public.crm_recycle_commands SET status='executed',result=v_results,executed_at=clock_timestamp()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
  END IF;
  RETURN jsonb_build_object('previewId',v_cmd.id,'status',v_cmd.status,'expiresAt',v_cmd.expires_at,
    'items',v_cmd.preview,'results',v_cmd.result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_recycle_batch_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recycle_batch_v1(text,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
