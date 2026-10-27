BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_items') IS NULL
     OR to_regclass('public.playbooks') IS NULL
     OR to_regclass('public.knowledge_sources') IS NULL THEN
    RAISE EXCEPTION 'Knowledge library tables are missing; inspect before migrating';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('knowledge_items','playbooks','knowledge_sources')
      AND column_name='deleted_at'
  ) OR to_regprocedure('public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Knowledge trash or state objects already exist; inspect before migrating';
  END IF;
END
$guard$;

ALTER TABLE public.knowledge_items ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.playbooks ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.knowledge_sources ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.knowledge_sources DROP CONSTRAINT knowledge_sources_domain_check;
ALTER TABLE public.knowledge_sources ADD CONSTRAINT knowledge_sources_domain_check
  CHECK (domain IN ('product','company','service','recruitment','industry','campaign',
    'health_wealth_seminar','top_performer_sharing','legal_tax','case','playbook','other'));

UPDATE public.knowledge_items SET metadata=jsonb_set(metadata,'{categories}',to_jsonb(ARRAY[
  CASE coalesce(metadata->>'domain','')
    WHEN 'product' THEN 'on_sale_product' WHEN 'service' THEN 'existing_service'
    WHEN 'recruitment' THEN 'recruitment_policy' WHEN 'industry' THEN 'industry_development'
    WHEN 'campaign' THEN 'marketing_activity' WHEN 'legal_tax' THEN 'legal_tax'
    WHEN 'health_wealth_seminar' THEN 'health_wealth_sharing' WHEN 'top_performer_sharing' THEN 'top_performer_sharing'
    WHEN 'company' THEN 'company_information' WHEN 'case' THEN 'customer_case'
    WHEN 'playbook' THEN 'conversation_strategy'
    ELSE CASE item_type WHEN 'case' THEN 'customer_case' WHEN 'regulation' THEN 'legal_tax' ELSE 'other' END
  END]),true)
  WHERE NOT (metadata ? 'categories');
UPDATE public.playbooks SET metadata=jsonb_set(metadata,'{categories}',to_jsonb(ARRAY['conversation_strategy']),true)
  WHERE NOT (metadata ? 'categories');
UPDATE public.knowledge_sources SET metadata=jsonb_set(metadata,'{categories}',to_jsonb(ARRAY[
  CASE domain WHEN 'product' THEN 'on_sale_product' WHEN 'company' THEN 'company_information'
    WHEN 'service' THEN 'existing_service' WHEN 'recruitment' THEN 'recruitment_policy'
    WHEN 'industry' THEN 'industry_development' WHEN 'campaign' THEN 'marketing_activity'
    WHEN 'health_wealth_seminar' THEN 'health_wealth_sharing' WHEN 'top_performer_sharing' THEN 'top_performer_sharing'
    WHEN 'legal_tax' THEN 'legal_tax' WHEN 'case' THEN 'customer_case' WHEN 'playbook' THEN 'conversation_strategy'
    ELSE 'other' END]),true)
  WHERE NOT (metadata ? 'categories');

CREATE INDEX knowledge_items_trash_idx ON public.knowledge_items(deleted_at DESC, updated_at DESC)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX playbooks_trash_idx ON public.playbooks(deleted_at DESC, updated_at DESC)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX knowledge_sources_trash_idx ON public.knowledge_sources(deleted_at DESC, updated_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE FUNCTION public.crm_knowledge_set_valid_v1(
  p_table text, p_id bigint, p_valid boolean, p_actor_uid text, p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $fn$
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
    UPDATE public.knowledge_items SET lifecycle_status='draft',verified=false,updated_by=p_actor_uid,
      updated_at=clock_timestamp() WHERE id=p_id;
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
$fn$;

REVOKE ALL ON FUNCTION public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)
  TO service_role;

COMMIT;
