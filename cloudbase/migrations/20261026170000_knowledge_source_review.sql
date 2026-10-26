BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Knowledge source review RPC already exists; inspect before migrating';
  END IF;
END $guard$;

CREATE FUNCTION public.crm_knowledge_source_review_v1(
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
    IF v_source.domain IN ('industry','legal_tax')
       AND (v_source.jurisdiction IS NULL OR v_source.source_uri IS NULL OR v_source.published_at IS NULL) THEN
      RAISE EXCEPTION 'Knowledge source metadata required';
    END IF;
    IF v_source.domain='top_performer_sharing'
       AND (v_source.metadata->>'sharing_authorized' IS DISTINCT FROM 'true'
         OR v_source.metadata->>'anonymized' IS DISTINCT FROM 'true') THEN
      RAISE EXCEPTION 'Knowledge sharing authorization required';
    END IF;
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

COMMIT;
