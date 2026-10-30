BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  v_definition text;
BEGIN
  IF pg_catalog.to_regprocedure('public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.knowledge_items'::pg_catalog.regclass
         AND conname = 'knowledge_items_reviewed_content_check'
     ) THEN
    RAISE EXCEPTION 'Knowledge activation baseline changed; inspect before migrating';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)'::regprocedure);
  IF position('IF v_source_id IS NOT NULL' IN v_definition) = 0
     OR position('crm_knowledge_source_review_v1' IN v_definition) = 0
     OR position('confidence=CASE WHEN item_type=' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Knowledge activation function changed; inspect before migrating';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.crm_knowledge_set_valid_v1(
  p_table text,p_id bigint,p_valid boolean,p_actor_uid text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  v_status text;
  v_updated_at timestamptz;
  v_source_id bigint;
  v_supersedes_id bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Knowledge service role required'; END IF;
  IF p_table IS NULL OR p_table NOT IN ('knowledge_items','playbooks') OR p_id IS NULL OR p_id<=0
     OR p_valid IS NULL OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 256
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Invalid knowledge state request';
  END IF;

  IF p_table='knowledge_items' THEN
    SELECT lifecycle_status,updated_at,source_id,supersedes_id
      INTO v_status,v_updated_at,v_source_id,v_supersedes_id
      FROM public.knowledge_items WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    SELECT lifecycle_status,updated_at,NULL::bigint,supersedes_id
      INTO v_status,v_updated_at,v_source_id,v_supersedes_id
      FROM public.playbooks WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge item not found'; END IF;
  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Knowledge item changed; reload'; END IF;
  IF p_valid AND v_status='verified' THEN RETURN jsonb_build_object('ok',true,'id',p_id,'status','verified'); END IF;
  IF NOT p_valid AND v_status='invalidated' THEN RETURN jsonb_build_object('ok',true,'id',p_id,'status','invalidated'); END IF;

  IF NOT p_valid THEN
    IF p_table='knowledge_items' THEN
      UPDATE public.knowledge_items SET lifecycle_status='invalidated',verified=false,
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
      IF v_source_id IS NOT NULL THEN
        UPDATE public.knowledge_sources SET lifecycle_status='invalidated',updated_by=p_actor_uid,
          updated_at=clock_timestamp() WHERE id=v_source_id AND deleted_at IS NULL;
      END IF;
    ELSE
      UPDATE public.playbooks SET lifecycle_status='invalidated',updated_by=p_actor_uid,
        updated_at=clock_timestamp() WHERE id=p_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',p_id,'status','invalidated');
  END IF;

  IF v_status NOT IN ('draft','invalidated') THEN
    RAISE EXCEPTION 'Superseded knowledge cannot be reactivated; edit the current version';
  END IF;

  IF v_source_id IS NOT NULL THEN
    UPDATE public.knowledge_sources SET lifecycle_status='draft',updated_by=p_actor_uid,
      updated_at=clock_timestamp() WHERE id=v_source_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge source is missing or deleted'; END IF;
    -- The editor's explicit Mark Active action is the human review. For sourced evidence
    -- with no supplied confidence, use the existing manual-entry default (0.8).
    -- Preserve any explicitly supplied value so the evidence quality guard still applies.
    UPDATE public.knowledge_items SET lifecycle_status='draft',verified=false,
      confidence=CASE WHEN item_type='evidence' THEN COALESCE(confidence,0.800::numeric) ELSE confidence END,
      updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
    SELECT updated_at INTO v_updated_at FROM public.knowledge_sources WHERE id=v_source_id;
    RETURN public.crm_knowledge_source_review_v1(p_actor_uid,v_source_id,p_id,'verify',v_updated_at);
  END IF;

  IF v_supersedes_id IS NOT NULL THEN
    IF p_table='knowledge_items' THEN
      UPDATE public.knowledge_items SET lifecycle_status='verified',verified=true
        WHERE id=v_supersedes_id AND lifecycle_status='superseded' AND deleted_at IS NULL;
    ELSE
      UPDATE public.playbooks SET lifecycle_status='verified'
        WHERE id=v_supersedes_id AND lifecycle_status='superseded' AND deleted_at IS NULL;
    END IF;
  END IF;
  IF p_table='knowledge_items' THEN
    UPDATE public.knowledge_items SET lifecycle_status='draft',verified=false,updated_by=p_actor_uid,
      updated_at=clock_timestamp() WHERE id=p_id;
  ELSE
    UPDATE public.playbooks SET lifecycle_status='draft',updated_by=p_actor_uid,
      updated_at=clock_timestamp() WHERE id=p_id;
  END IF;
  IF p_table='knowledge_items' THEN
    SELECT updated_at INTO v_updated_at FROM public.knowledge_items WHERE id=p_id;
  ELSE
    SELECT updated_at INTO v_updated_at FROM public.playbooks WHERE id=p_id;
  END IF;
  RETURN public.crm_knowledge_review_v1(p_table,p_id,'verify',p_actor_uid,v_updated_at);
END
$function$;

COMMIT;
