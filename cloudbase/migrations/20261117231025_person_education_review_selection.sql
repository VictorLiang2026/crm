BEGIN;

-- Add searchable cohort selection and field-level reviewed updates; existing batches remain untouched.
CREATE OR REPLACE FUNCTION public.crm_education_backfill_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $workflow$
DECLARE
  b public.person_education_batches%ROWTYPE;
  i public.person_education_items%ROWTYPE;
  v public.person_education_previews%ROWTYPE;
  c public.person_education_changes%ROWTYPE;
  p public.persons%ROWTYPE;
  ctx jsonb; r jsonb; outrows jsonb:='[]'; patch jsonb; before_state jsonb;
  chosen jsonb; candidate jsonb; evidence jsonb; source_row jsonb;
  school_action text; major_action text;
  fingerprint text; call_limit integer; ids jsonb; v_now timestamptz; search_query text; search_offset integer;
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
    length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
    jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>2000000 THEN
    RAISE EXCEPTION 'EDUCATION_ACCESS_DENIED';
  END IF;
  IF p_operation='create' THEN
    call_limit:=(p_data->>'maxCalls')::integer;
    ids:=coalesce(p_data->'personIds','[]');
    IF call_limit NOT BETWEEN 1 AND 5000 OR call_limit IS NULL OR
      (p_data ? 'sampleSize' AND (p_data->>'sampleSize')::integer NOT BETWEEN 1 AND 1500) OR
      jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)>1500 THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
    SELECT * INTO b FROM public.person_education_batches WHERE actor_uid=p_actor_uid AND request_key=(p_data->>'requestKey')::uuid;
    IF FOUND THEN
      IF b.max_calls<>call_limit OR b.person_ids<>ids OR b.sample_size IS DISTINCT FROM (p_data->>'sampleSize')::integer THEN
        RAISE EXCEPTION 'EDUCATION_IDEMPOTENCY_CONFLICT'; END IF;
      RETURN jsonb_build_object('batchId',b.id,'reused',true);
    END IF;
    INSERT INTO public.person_education_batches(actor_uid,request_key,max_calls,person_ids,sample_size)
      VALUES(p_actor_uid,(p_data->>'requestKey')::uuid,call_limit,ids,(p_data->>'sampleSize')::integer) RETURNING * INTO b;
    INSERT INTO public.person_education_items(batch_id,person_id)
      SELECT b.id,p0.id FROM public.persons p0 WHERE p0.deleted_at IS NULL
        AND (jsonb_array_length(ids)=0 OR ids ? p0.id::text)
        AND (nullif(btrim(p0.graduation_school),'') IS NULL OR nullif(btrim(p0.department_or_major),'') IS NULL)
      ORDER BY p0.created_at DESC,p0.id DESC LIMIT b.sample_size;
    IF NOT FOUND THEN UPDATE public.person_education_batches SET status='completed' WHERE id=b.id; END IF;
    RETURN jsonb_build_object('batchId',b.id,'reused',false);
  ELSIF p_operation='queue' THEN
    RETURN jsonb_build_object('jobs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
      (SELECT id,actor_uid FROM public.person_education_batches WHERE status='active' ORDER BY created_at LIMIT 20) x),'[]'));
  ELSIF p_operation='batches' THEN
    RETURN jsonb_build_object('batches',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
      (SELECT * FROM public.person_education_batches WHERE actor_uid=p_actor_uid ORDER BY created_at DESC LIMIT 30) x),'[]'));
  ELSIF p_operation='people' THEN
    search_query:=nullif(btrim(p_data->>'query'),'');
    search_offset:=coalesce((p_data->>'offset')::integer,0);
    IF length(search_query)>100 OR search_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
    RETURN jsonb_build_object('people',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
      (SELECT p0.id::text AS person_id,p0.display_name,p0.created_at,p0.graduation_school,p0.department_or_major
       FROM public.persons p0 WHERE p0.deleted_at IS NULL
         AND (nullif(btrim(p0.graduation_school),'') IS NULL OR nullif(btrim(p0.department_or_major),'') IS NULL)
         AND (search_query IS NULL OR p0.id::text=search_query OR
           strpos(lower(coalesce(p0.display_name,'')),lower(search_query))>0)
       ORDER BY p0.created_at DESC,p0.id DESC
       LIMIT 50 OFFSET search_offset) x),'[]'));
  END IF;
  SELECT * INTO b FROM public.person_education_batches WHERE id=(p_data->>'batchId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_NOT_FOUND'; END IF;
  IF p_operation IN ('status','claim') THEN
    -- Reconcile leases even when paused or at the budget ceiling, so nothing stays running forever.
    UPDATE public.person_education_items SET status='failed',error_code='EDUCATION_LEASE_EXPIRED',lease_token=NULL,lease_until=NULL
      WHERE batch_id=b.id AND status='running' AND lease_until<clock_timestamp();
  END IF;
  IF p_operation='status' THEN
    RETURN jsonb_build_object('batch',to_jsonb(b),'counts',coalesce((SELECT jsonb_object_agg(status,n) FROM
      (SELECT status,count(*) n FROM public.person_education_items WHERE batch_id=b.id GROUP BY status) q),'{}'),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
      (SELECT x0.*,p0.display_name,p0.created_at,p0.graduation_school,p0.department_or_major FROM public.person_education_items x0 JOIN public.persons p0 ON p0.id=x0.person_id
        WHERE x0.batch_id=b.id ORDER BY x0.person_id LIMIT 50 OFFSET greatest(0,coalesce((p_data->>'offset')::integer,0))) x),'[]'));
  ELSIF p_operation IN ('pause','resume') THEN
    UPDATE public.person_education_batches SET status=CASE WHEN p_operation='pause' THEN 'paused'
      WHEN calls_used>=max_calls THEN 'budget_exhausted' ELSE 'active' END WHERE id=b.id;
    RETURN jsonb_build_object('batchId',b.id);
  ELSIF p_operation='retry' THEN
    UPDATE public.person_education_items SET status='pending',error_code=NULL,lease_token=NULL,lease_until=NULL
      WHERE batch_id=b.id AND id=(p_data->>'itemId')::uuid AND status='failed';
    IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_INVALID_STATE'; END IF;
    IF b.status='completed' AND b.calls_used<b.max_calls THEN UPDATE public.person_education_batches SET status='active' WHERE id=b.id; END IF;
    RETURN jsonb_build_object('retried',true);
  ELSIF p_operation='skip' THEN
    UPDATE public.person_education_items SET status='skipped',updated_at=clock_timestamp()
      WHERE batch_id=b.id AND id=(p_data->>'itemId')::uuid AND status IN ('ready','needs_review','no_evidence','failed');
    IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_INVALID_STATE'; END IF;
    RETURN jsonb_build_object('skipped',true);
  ELSIF p_operation='claim' THEN
    IF b.status<>'active' THEN RETURN jsonb_build_object('idle',true); END IF;
    IF b.calls_used>=b.max_calls THEN
      UPDATE public.person_education_batches SET status='budget_exhausted' WHERE id=b.id;
      RETURN jsonb_build_object('idle',true,'budgetExhausted',true);
    END IF;
    -- Expired AI calls may still have incurred a charge: do not automatically repeat them.
    SELECT * INTO i FROM public.person_education_items WHERE batch_id=b.id AND status='pending' ORDER BY person_id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      IF NOT EXISTS(SELECT 1 FROM public.person_education_items WHERE batch_id=b.id AND status='running') THEN
        UPDATE public.person_education_batches SET status='completed' WHERE id=b.id;
      END IF;
      RETURN jsonb_build_object('idle',true);
    END IF;
    ctx:=public.crm_education_context_v1(i.person_id);
    IF ctx IS NULL THEN
      UPDATE public.person_education_items SET status='skipped',error_code='EDUCATION_PERSON_UNAVAILABLE' WHERE id=i.id;
      RETURN jsonb_build_object('idle',false,'skipped',true);
    END IF;
    fingerprint:=md5(ctx::text);
    IF i.source_hash IS DISTINCT FROM fingerprint THEN
      i.chunk_cursor:=0; i.partial_result:='[]';
    END IF;
    UPDATE public.person_education_items SET status='running',source_hash=fingerprint,chunk_cursor=i.chunk_cursor,
      partial_result=i.partial_result,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '4 minutes',
      updated_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;
    UPDATE public.person_education_batches SET calls_used=calls_used+1 WHERE id=b.id;
    RETURN jsonb_build_object('item',to_jsonb(i),'context',ctx,'actorUid',b.actor_uid);
  ELSIF p_operation='finish' THEN
    SELECT * INTO i FROM public.person_education_items WHERE batch_id=b.id AND id=(p_data->>'itemId')::uuid FOR UPDATE;
    IF NOT FOUND OR i.status<>'running' OR i.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid THEN
      RAISE EXCEPTION 'EDUCATION_LEASE_STALE';
    END IF;
    ctx:=public.crm_education_context_v1(i.person_id);
    IF ctx IS NULL OR md5(ctx::text)<>i.source_hash THEN
      UPDATE public.person_education_items SET status='failed',error_code='EDUCATION_SOURCE_CHANGED',lease_token=NULL WHERE id=i.id;
      RETURN jsonb_build_object('stale',true);
    END IF;
    IF p_data ? 'errorCode' THEN
      UPDATE public.person_education_items SET status='failed',error_code=left(p_data->>'errorCode',80),lease_token=NULL WHERE id=i.id;
      RETURN jsonb_build_object('failed',true);
    END IF;
    IF (p_data->>'cursor')::integer<>i.chunk_cursor OR (p_data->>'totalChunks')::integer<1 OR
      jsonb_typeof(p_data->'partial') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
    UPDATE public.person_education_items SET chunk_cursor=chunk_cursor+1,total_chunks=(p_data->>'totalChunks')::integer,
      partial_result=p_data->'partial',result=p_data->'result',status=CASE
      WHEN (p_data->>'complete')::boolean THEN CASE WHEN jsonb_array_length(p_data->'result'->'candidates')=0 THEN 'no_evidence'
        WHEN (p_data->'result'->>'needsReview')::boolean THEN 'needs_review' ELSE 'ready' END ELSE 'pending' END,
      lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE id=i.id;
    RETURN jsonb_build_object('saved',true);
  ELSIF p_operation='plan' THEN
    IF p_data->>'kind' NOT IN ('apply','undo') OR p_data->>'kind' IS NULL THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
    UPDATE public.person_education_batches SET plan_token=gen_random_uuid(),plan_kind=p_data->>'kind',
      plan_expires_at=clock_timestamp()+interval '15 minutes' WHERE id=b.id RETURNING * INTO b;
    RETURN jsonb_build_object('operation',CASE WHEN b.plan_kind='undo' THEN 'undo_education_update' ELSE 'fill_empty_education' END,
      'batchId',b.id,'planId',b.plan_token,'requiresPreview',true,
      'requiresConfirmation',true,'allowedFields',jsonb_build_array('graduation_school','department_or_major'));
  ELSIF p_operation IN ('preview','undoPreview') THEN
    IF b.plan_token IS NULL OR b.plan_token IS DISTINCT FROM (p_data->>'planId')::uuid OR
      b.plan_expires_at<clock_timestamp() OR b.plan_kind<>(CASE WHEN p_operation='preview' THEN 'apply' ELSE 'undo' END) THEN
      RAISE EXCEPTION 'EDUCATION_PLAN_REQUIRED'; END IF;
    IF jsonb_typeof(p_data->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'rows') NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'EDUCATION_INVALID_INPUT';
    END IF;
    FOR chosen IN SELECT value FROM jsonb_array_elements(p_data->'rows') LOOP
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(outrows) z WHERE z->>'itemId'=chosen->>'itemId') THEN
        RAISE EXCEPTION 'EDUCATION_DUPLICATE_SELECTION'; END IF;
      SELECT * INTO i FROM public.person_education_items WHERE id=(chosen->>'itemId')::uuid AND batch_id=b.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_NOT_FOUND'; END IF;
      SELECT * INTO p FROM public.persons WHERE id=i.person_id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_PERSON_UNAVAILABLE'; END IF;
      before_state:=jsonb_build_object('graduation_school',p.graduation_school,'department_or_major',p.department_or_major);
      IF p_operation='preview' THEN
        IF i.status NOT IN ('ready','needs_review') THEN RAISE EXCEPTION 'EDUCATION_INVALID_STATE'; END IF;
        ctx:=public.crm_education_context_v1(i.person_id);
        IF md5(ctx::text)<>i.source_hash THEN RAISE EXCEPTION 'EDUCATION_SOURCE_CHANGED'; END IF;
        candidate:=i.result->'candidates'->((chosen->>'candidateIndex')::integer);
        IF candidate IS NULL OR candidate->>'relationship' IS DISTINCT FROM 'self' OR candidate->>'educationType' IS DISTINCT FROM 'graduated'
          OR candidate->>'ambiguous' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'EDUCATION_CANDIDATE_UNVERIFIED'; END IF;
        FOR evidence IN SELECT value FROM jsonb_array_elements(candidate->'evidence') LOOP
          SELECT value INTO source_row FROM jsonb_array_elements(ctx->'sources') s WHERE
            s->>'table'=evidence->>'table' AND s->>'id'=evidence->>'id' AND s->>'field'=evidence->>'field';
          IF source_row IS NULL OR nullif(evidence->>'quote','') IS NULL OR
            position((evidence->>'quote') in (source_row->>'text'))=0 THEN RAISE EXCEPTION 'EDUCATION_EVIDENCE_STALE'; END IF;
        END LOOP;
        patch:='{}';
        IF jsonb_array_length(candidate->'evidence')=0 THEN RAISE EXCEPTION 'EDUCATION_EVIDENCE_STALE'; END IF;
        IF chosen ? 'schoolAction' OR chosen ? 'majorAction' THEN
          IF NOT (chosen ? 'schoolAction' AND chosen ? 'majorAction') OR
            chosen->>'schoolAction' NOT IN ('keep','candidate','manual') OR chosen->>'majorAction' NOT IN ('keep','candidate','manual') THEN
            RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
          school_action:=chosen->>'schoolAction';major_action:=chosen->>'majorAction';
        ELSE
          -- Transitional compatibility for an older Console bundle. Legacy choices still cannot replace non-empty values.
          IF jsonb_typeof(chosen->'school') IS DISTINCT FROM 'boolean' OR jsonb_typeof(chosen->'major') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
          school_action:=CASE WHEN (chosen->>'school')::boolean AND nullif(btrim(p.graduation_school),'') IS NULL THEN 'candidate' ELSE 'keep' END;
          major_action:=CASE WHEN (chosen->>'major')::boolean AND nullif(btrim(p.department_or_major),'') IS NULL THEN 'candidate' ELSE 'keep' END;
        END IF;
        IF school_action='candidate' THEN
          IF nullif(btrim(candidate->>'school'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'evidence') e
            WHERE e->>'supports' IN ('school','both')) THEN RAISE EXCEPTION 'EDUCATION_UNSUPPORTED_FIELD'; END IF;
          IF p.graduation_school IS DISTINCT FROM candidate->>'school' THEN patch:=patch||jsonb_build_object('graduation_school',candidate->>'school'); END IF;
        ELSIF school_action='manual' THEN
          IF nullif(btrim(chosen->>'schoolValue'),'') IS NULL OR length(chosen->>'schoolValue')>160 THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
          IF p.graduation_school IS DISTINCT FROM btrim(chosen->>'schoolValue') THEN patch:=patch||jsonb_build_object('graduation_school',btrim(chosen->>'schoolValue')); END IF;
        END IF;
        IF major_action='candidate' THEN
          IF nullif(btrim(candidate->>'major'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'evidence') e
            WHERE e->>'supports' IN ('major','both')) THEN RAISE EXCEPTION 'EDUCATION_UNSUPPORTED_FIELD'; END IF;
          IF p.department_or_major IS DISTINCT FROM candidate->>'major' THEN patch:=patch||jsonb_build_object('department_or_major',candidate->>'major'); END IF;
        ELSIF major_action='manual' THEN
          IF nullif(btrim(chosen->>'majorValue'),'') IS NULL OR length(chosen->>'majorValue')>160 THEN RAISE EXCEPTION 'EDUCATION_INVALID_INPUT'; END IF;
          IF p.department_or_major IS DISTINCT FROM btrim(chosen->>'majorValue') THEN patch:=patch||jsonb_build_object('department_or_major',btrim(chosen->>'majorValue')); END IF;
        END IF;
        IF patch='{}' THEN RAISE EXCEPTION 'EDUCATION_EMPTY_PATCH'; END IF;
        -- Keep the existing school/major pairing guard when only one AI field is changed.
        IF school_action='candidate' AND major_action='keep'
          AND nullif(btrim(p.department_or_major),'') IS NOT NULL AND p.department_or_major IS DISTINCT FROM candidate->>'major' THEN
          RAISE EXCEPTION 'EDUCATION_SCHOOL_MAJOR_CONFLICT'; END IF;
        IF major_action='candidate' AND school_action='keep'
          AND nullif(btrim(p.graduation_school),'') IS NOT NULL AND p.graduation_school IS DISTINCT FROM candidate->>'school' THEN
          RAISE EXCEPTION 'EDUCATION_SCHOOL_MAJOR_CONFLICT'; END IF;
        outrows:=outrows||jsonb_build_array(jsonb_build_object('itemId',i.id,'personId',p.id::text,'displayName',p.display_name,
          'before',before_state,'patch',patch,'fieldActions',jsonb_build_object('school',school_action,'major',major_action),
          'updatedAt',p.updated_at,'sourceHash',i.source_hash,'candidate',candidate));
      ELSE
        SELECT * INTO c FROM public.person_education_changes WHERE item_id=i.id AND reverted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
        IF NOT FOUND OR i.status<>'applied' OR p.updated_at IS DISTINCT FROM c.after_updated_at OR before_state<>c.after_values THEN
          RAISE EXCEPTION 'EDUCATION_UNDO_CONFLICT'; END IF;
        outrows:=outrows||jsonb_build_array(jsonb_build_object('itemId',i.id,'personId',p.id::text,'displayName',p.display_name,
          'before',before_state,'patch',c.before_values,'updatedAt',p.updated_at,'changeId',c.id));
      END IF;
    END LOOP;
    INSERT INTO public.person_education_previews(actor_uid,batch_id,kind,rows) VALUES(p_actor_uid,b.id,
      CASE WHEN p_operation='preview' THEN 'apply' ELSE 'undo' END,outrows) RETURNING * INTO v;
    RETURN jsonb_build_object('previewId',v.id,'rows',v.rows,'expiresAt',v.expires_at,'kind',v.kind);
  ELSIF p_operation IN ('confirm','execute') THEN
    SELECT * INTO v FROM public.person_education_previews WHERE id=(p_data->>'previewId')::uuid
      AND batch_id=b.id AND actor_uid=p_actor_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDUCATION_NOT_FOUND'; END IF;
    IF p_operation='execute' AND (v.status NOT IN ('confirmed','executed') OR v.confirmation_token IS NULL OR
      v.confirmation_token IS DISTINCT FROM (p_data->>'confirmationToken')::uuid) THEN RAISE EXCEPTION 'EDUCATION_CONFIRMATION_REQUIRED'; END IF;
    IF v.status='executed' AND p_operation='execute' THEN RETURN v.result; END IF;
    IF v.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'EDUCATION_PREVIEW_EXPIRED'; END IF;
    IF p_operation='confirm' THEN
      IF v.status NOT IN ('preview','confirmed') THEN RAISE EXCEPTION 'EDUCATION_INVALID_STATE'; END IF;
      UPDATE public.person_education_previews SET status='confirmed',confirmation_token=coalesce(confirmation_token,gen_random_uuid()),
        confirmed_at=coalesce(confirmed_at,clock_timestamp()) WHERE id=v.id RETURNING * INTO v;
      RETURN jsonb_build_object('confirmationToken',v.confirmation_token,'previewId',v.id);
    END IF;
    FOR r IN SELECT value FROM jsonb_array_elements(v.rows) LOOP
      SELECT * INTO i FROM public.person_education_items WHERE id=(r->>'itemId')::uuid AND batch_id=b.id FOR UPDATE;
      SELECT * INTO p FROM public.persons WHERE id=(r->>'personId')::bigint AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND OR p.updated_at IS DISTINCT FROM (r->>'updatedAt')::timestamptz OR
        jsonb_build_object('graduation_school',p.graduation_school,'department_or_major',p.department_or_major)<>r->'before' THEN
        RAISE EXCEPTION 'EDUCATION_PREVIEW_STALE'; END IF;
      IF v.kind='apply' THEN
        IF i.status NOT IN ('ready','needs_review') OR md5(public.crm_education_context_v1(i.person_id)::text)<>r->>'sourceHash' THEN
          RAISE EXCEPTION 'EDUCATION_SOURCE_CHANGED'; END IF;
      ELSE
        SELECT * INTO c FROM public.person_education_changes WHERE id=(r->>'changeId')::uuid AND item_id=i.id AND reverted_at IS NULL FOR UPDATE;
        IF NOT FOUND OR i.status<>'applied' THEN RAISE EXCEPTION 'EDUCATION_UNDO_CONFLICT'; END IF;
      END IF;
      v_now:=clock_timestamp(); patch:=r->'patch';
      -- Same canonical Person fields and optimistic-lock contract as PersonService.
      -- One transaction is required so business writes cannot outlive their audit row.
      UPDATE public.persons SET graduation_school=CASE WHEN patch ? 'graduation_school' THEN patch->>'graduation_school' ELSE graduation_school END,
        department_or_major=CASE WHEN patch ? 'department_or_major' THEN patch->>'department_or_major' ELSE department_or_major END,
        updated_at=v_now WHERE id=p.id;
      IF v.kind='apply' THEN
        INSERT INTO public.person_education_changes(preview_id,item_id,actor_uid,before_values,after_values,after_updated_at)
          VALUES(v.id,i.id,p_actor_uid,r->'before',(r->'before')||patch,v_now);
        UPDATE public.person_education_items SET status='applied',updated_at=v_now WHERE id=i.id;
      ELSE
        UPDATE public.person_education_changes SET reverted_at=v_now,reverted_by_uid=p_actor_uid WHERE id=c.id;
        UPDATE public.person_education_items SET status='undone',updated_at=v_now WHERE id=i.id;
      END IF;
      outrows:=outrows||jsonb_build_array(jsonb_build_object('personId',p.id::text,'itemId',i.id));
    END LOOP;
    UPDATE public.person_education_previews SET status='executed',result=jsonb_build_object('kind',v.kind,'rows',outrows)
      WHERE id=v.id RETURNING * INTO v;
    RETURN v.result;
  END IF;
  RAISE EXCEPTION 'EDUCATION_INVALID_OPERATION';
END $workflow$;

COMMIT;
