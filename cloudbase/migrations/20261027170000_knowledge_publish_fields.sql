BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regprocedure('public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)') IS NULL
     OR position('sharing_authorized' IN pg_catalog.pg_get_functiondef(
       'public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)'::pg_catalog.regprocedure)) = 0
     OR position('CONTENT_NOT_CURRENT' IN pg_catalog.pg_get_functiondef(
       'public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)'::pg_catalog.regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Knowledge source review baseline changed; inspect before migrating';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.crm_knowledge_source_review_v1(
  p_actor_uid text,p_source_id bigint,p_item_id bigint,p_action text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_source public.knowledge_sources%ROWTYPE;
  v_item public.knowledge_items%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Knowledge service role required'; END IF;
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 256
     OR p_source_id IS NULL OR p_source_id<=0 OR p_item_id IS NULL OR p_item_id<=0
     OR p_action NOT IN ('verify','invalidate') THEN RAISE EXCEPTION 'Invalid knowledge source review'; END IF;
  SELECT * INTO v_source FROM public.knowledge_sources WHERE id=p_source_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge source not found'; END IF;
  IF p_action='verify' THEN
    IF v_source.lifecycle_status<>'draft' OR v_source.extraction_status<>'draft'
       OR v_source.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Knowledge source is stale'; END IF;
  ELSIF v_source.lifecycle_status<>'verified' THEN
    RAISE EXCEPTION 'Only verified knowledge source can be invalidated';
  END IF;
  SELECT * INTO v_item FROM public.knowledge_items
    WHERE id=p_item_id AND source_id=p_source_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge draft does not match source'; END IF;
  IF p_action='verify' THEN
    IF v_item.lifecycle_status<>'draft' OR v_item.verified THEN RAISE EXCEPTION 'Knowledge draft is stale'; END IF;
    UPDATE public.knowledge_sources SET lifecycle_status='verified',verified_by=p_actor_uid,
      updated_by=p_actor_uid,updated_at=now() WHERE id=p_source_id;
    UPDATE public.knowledge_items SET lifecycle_status='verified',verified=true,
      verified_by=p_actor_uid,updated_by=p_actor_uid,updated_at=now() WHERE id=p_item_id;
  ELSE
    UPDATE public.knowledge_sources SET lifecycle_status='invalidated',updated_by=p_actor_uid,updated_at=now() WHERE id=p_source_id;
    UPDATE public.knowledge_items SET lifecycle_status='invalidated',verified=false,
      updated_by=p_actor_uid,updated_at=now() WHERE id=p_item_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'sourceId',p_source_id,'itemId',p_item_id,'decision',p_action,
    'lifecycleStatus',CASE WHEN p_action='verify' THEN 'verified' ELSE 'invalidated' END);
END $fn$;

REVOKE ALL ON FUNCTION public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.crm_knowledge_review_v1(
  p_table text,p_id bigint,p_action text,p_actor_uid text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
  v_status text;
  v_item_type text;
  v_source text;
  v_confidence numeric;
  v_supersedes_id bigint;
  v_updated_at timestamptz;
  v_verified boolean;
  v_parent_status text;
  v_parent_type text;
BEGIN
  IF p_table NOT IN ('knowledge_items','playbooks') OR p_id IS NULL OR p_id<1 OR
     p_action NOT IN ('verify','invalidate') OR length(btrim(coalesce(p_actor_uid,''))) NOT BETWEEN 1 AND 128 OR
     p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_REVIEW_REQUEST' USING ERRCODE='22023';
  END IF;
  IF p_table='knowledge_items' THEN
    SELECT lifecycle_status,item_type,source,confidence,supersedes_id,updated_at,verified
      INTO v_status,v_item_type,v_source,v_confidence,v_supersedes_id,v_updated_at,v_verified
      FROM public.knowledge_items WHERE id=p_id FOR UPDATE;
  ELSE
    SELECT lifecycle_status,scenario,source,confidence,supersedes_id,updated_at,NULL::boolean
      INTO v_status,v_item_type,v_source,v_confidence,v_supersedes_id,v_updated_at,v_verified
      FROM public.playbooks WHERE id=p_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONTENT_STALE' USING ERRCODE='40001';
  END IF;
  IF p_action='invalidate' THEN
    IF v_status NOT IN ('draft','verified') THEN RAISE EXCEPTION 'CONTENT_NOT_ACTIVE' USING ERRCODE='23514'; END IF;
    IF p_table='knowledge_items' THEN
      UPDATE public.knowledge_items SET lifecycle_status='invalidated',verified=false,
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
    ELSE
      UPDATE public.playbooks SET lifecycle_status='invalidated',updated_by=p_actor_uid,
        updated_at=clock_timestamp() WHERE id=p_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',p_id,'table',p_table,'status','invalidated');
  END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'CONTENT_NOT_DRAFT' USING ERRCODE='23514'; END IF;
  IF nullif(btrim(v_source),'') IS NULL THEN RAISE EXCEPTION 'SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF p_table='knowledge_items' AND v_item_type='evidence' AND
     (v_confidence IS NULL OR v_confidence<0.700) THEN
    RAISE EXCEPTION 'EVIDENCE_CONFIDENCE_TOO_LOW' USING ERRCODE='23514';
  END IF;
  IF v_supersedes_id IS NOT NULL THEN
    IF p_table='knowledge_items' THEN
      SELECT lifecycle_status,item_type INTO v_parent_status,v_parent_type
        FROM public.knowledge_items WHERE id=v_supersedes_id FOR UPDATE;
      IF NOT FOUND OR v_parent_status<>'verified' OR v_parent_type IS DISTINCT FROM v_item_type THEN
        RAISE EXCEPTION 'REVISION_PARENT_STALE_OR_TYPE_MISMATCH' USING ERRCODE='23514';
      END IF;
      UPDATE public.knowledge_items SET lifecycle_status='superseded',verified=false,
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=v_supersedes_id;
    ELSE
      SELECT lifecycle_status,scenario INTO v_parent_status,v_parent_type
        FROM public.playbooks WHERE id=v_supersedes_id FOR UPDATE;
      IF NOT FOUND OR v_parent_status<>'verified' OR v_parent_type IS DISTINCT FROM v_item_type THEN
        RAISE EXCEPTION 'REVISION_PARENT_STALE_OR_TYPE_MISMATCH' USING ERRCODE='23514';
      END IF;
      UPDATE public.playbooks SET lifecycle_status='superseded',updated_by=p_actor_uid,
        updated_at=clock_timestamp() WHERE id=v_supersedes_id;
    END IF;
  END IF;
  IF p_table='knowledge_items' THEN
    UPDATE public.knowledge_items SET lifecycle_status='verified',verified=true,
      verified_by=p_actor_uid,updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
  ELSE
    UPDATE public.playbooks SET lifecycle_status='verified',verified_by=p_actor_uid,
      updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'table',p_table,'status','verified');
END $fn$;

REVOKE ALL ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)
  TO service_role;

COMMENT ON COLUMN public.knowledge_items.valid_to IS
  'Legacy field retained for compatibility; the Knowledge Library no longer gates publication or AI use by this date';
COMMENT ON COLUMN public.playbooks.evidence_refs IS
  'Legacy field retained for compatibility; new conversation strategies are selected by scenario and objection';

COMMIT;
