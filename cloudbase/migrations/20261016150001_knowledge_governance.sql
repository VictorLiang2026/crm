BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_items') IS NULL OR to_regclass('public.playbooks') IS NULL THEN
    RAISE EXCEPTION 'PC22 requires public.knowledge_items and public.playbooks';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('knowledge_items','playbooks')
      AND column_name IN ('lifecycle_status','created_by','updated_by','verified_by',
        'supersedes_id','version_no','updated_at')
  ) THEN
    RAISE EXCEPTION 'PC22 governance columns already exist; inspect schema before applying';
  END IF;
END
$guard$;

ALTER TABLE public.knowledge_items
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN created_by text,
  ADD COLUMN updated_by text,
  ADD COLUMN verified_by text,
  ADD COLUMN supersedes_id bigint,
  ADD COLUMN version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.knowledge_items
SET lifecycle_status = CASE WHEN verified THEN 'verified' ELSE 'draft' END;

ALTER TABLE public.knowledge_items
  ADD CONSTRAINT knowledge_items_lifecycle_status_check
    CHECK (lifecycle_status IN ('draft','verified','superseded','invalidated')),
  ADD CONSTRAINT knowledge_items_status_verified_check
    CHECK ((lifecycle_status = 'verified') = verified),
  ADD CONSTRAINT knowledge_items_version_no_check CHECK (version_no > 0),
  ADD CONSTRAINT knowledge_items_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.knowledge_items(id) ON DELETE RESTRICT;

ALTER TABLE public.playbooks
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN created_by text,
  ADD COLUMN updated_by text,
  ADD COLUMN verified_by text,
  ADD COLUMN supersedes_id bigint,
  ADD COLUMN version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN source text,
  ADD COLUMN confidence numeric(4,3),
  ADD COLUMN valid_from date,
  ADD COLUMN valid_to date,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.playbooks
  ADD CONSTRAINT playbooks_lifecycle_status_check
    CHECK (lifecycle_status IN ('draft','verified','superseded','invalidated')),
  ADD CONSTRAINT playbooks_version_no_check CHECK (version_no > 0),
  ADD CONSTRAINT playbooks_confidence_check CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT playbooks_valid_period_check
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  ADD CONSTRAINT playbooks_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT playbooks_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.playbooks(id) ON DELETE RESTRICT;

CREATE INDEX knowledge_items_governance_active_idx
  ON public.knowledge_items(item_type, lifecycle_status, valid_to, source_date);
CREATE INDEX playbooks_governance_active_idx
  ON public.playbooks(lifecycle_status, scenario, valid_to, created_at DESC);
CREATE INDEX knowledge_items_supersedes_idx ON public.knowledge_items(supersedes_id);
CREATE INDEX playbooks_supersedes_idx ON public.playbooks(supersedes_id);

CREATE FUNCTION public.crm_knowledge_review_v1(
  p_table text,
  p_id bigint,
  p_action text,
  p_actor_uid text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_status text;
  v_item_type text;
  v_source text;
  v_source_date date;
  v_valid_from date;
  v_valid_to date;
  v_confidence numeric;
  v_supersedes_id bigint;
  v_updated_at timestamptz;
  v_evidence_refs bigint[];
  v_case_refs bigint[];
  v_story_refs bigint[];
  v_ref bigint;
  v_ref_type text;
  v_ref_status text;
  v_ref_verified boolean;
  v_ref_source text;
  v_ref_source_date date;
  v_ref_valid_from date;
  v_ref_valid_to date;
  v_ref_confidence numeric;
  v_parent_status text;
  v_parent_type text;
  v_now date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  IF p_table NOT IN ('knowledge_items','playbooks') OR p_id IS NULL OR p_id < 1 OR
     p_action NOT IN ('verify','invalidate') OR length(btrim(coalesce(p_actor_uid,''))) NOT BETWEEN 1 AND 128 OR
     p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_REVIEW_REQUEST' USING ERRCODE='22023';
  END IF;

  IF p_table='knowledge_items' THEN
    SELECT lifecycle_status,item_type,source,source_date,valid_from,valid_to,confidence,
      supersedes_id,updated_at,verified
    INTO v_status,v_item_type,v_source,v_source_date,v_valid_from,v_valid_to,v_confidence,
      v_supersedes_id,v_updated_at,v_ref_verified
    FROM public.knowledge_items WHERE id=p_id FOR UPDATE;
  ELSE
    SELECT lifecycle_status,scenario,source,NULL::date,valid_from,valid_to,confidence,
      supersedes_id,updated_at,NULL::boolean
    INTO v_status,v_item_type,v_source,v_source_date,v_valid_from,v_valid_to,v_confidence,
      v_supersedes_id,v_updated_at,v_ref_verified
    FROM public.playbooks WHERE id=p_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONTENT_STALE' USING ERRCODE='40001';
  END IF;

  IF p_action='invalidate' THEN
    IF v_status NOT IN ('draft','verified') THEN
      RAISE EXCEPTION 'CONTENT_NOT_ACTIVE' USING ERRCODE='23514';
    END IF;
    IF p_table='knowledge_items' THEN
      UPDATE public.knowledge_items SET lifecycle_status='invalidated',verified=false,
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
    ELSE
      UPDATE public.playbooks SET lifecycle_status='invalidated',
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',p_id,'table',p_table,'status','invalidated');
  END IF;

  IF v_status <> 'draft' THEN RAISE EXCEPTION 'CONTENT_NOT_DRAFT' USING ERRCODE='23514'; END IF;
  IF nullif(btrim(v_source),'') IS NULL THEN RAISE EXCEPTION 'SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF v_valid_from IS NOT NULL AND v_valid_from > v_now OR
     v_valid_to IS NOT NULL AND v_valid_to < v_now OR
     v_source_date IS NOT NULL AND v_source_date > v_now THEN
    RAISE EXCEPTION 'CONTENT_NOT_CURRENT' USING ERRCODE='23514';
  END IF;

  IF p_table='knowledge_items' THEN
    IF v_item_type='evidence' AND (v_confidence IS NULL OR v_confidence < 0.700) THEN
      RAISE EXCEPTION 'EVIDENCE_CONFIDENCE_TOO_LOW' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT evidence_refs,case_refs,story_refs INTO v_evidence_refs,v_case_refs,v_story_refs
      FROM public.playbooks WHERE id=p_id;
    FOREACH v_ref IN ARRAY coalesce(v_evidence_refs,'{}'::bigint[]) LOOP
      SELECT item_type,lifecycle_status,verified,source,source_date,valid_from,valid_to,confidence
        INTO v_ref_type,v_ref_status,v_ref_verified,v_ref_source,v_ref_source_date,
          v_ref_valid_from,v_ref_valid_to,v_ref_confidence
        FROM public.knowledge_items WHERE id=v_ref;
      IF NOT FOUND OR v_ref_type<>'evidence' OR v_ref_status<>'verified' OR v_ref_verified IS DISTINCT FROM true OR
         nullif(btrim(v_ref_source),'') IS NULL OR v_ref_confidence IS NULL OR v_ref_confidence<0.700 OR
         (v_ref_source_date IS NOT NULL AND v_ref_source_date>v_now) OR
         (v_ref_valid_from IS NOT NULL AND v_ref_valid_from>v_now) OR
         (v_ref_valid_to IS NOT NULL AND v_ref_valid_to<v_now) THEN
        RAISE EXCEPTION 'EVIDENCE_REFERENCE_INVALID' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOREACH v_ref IN ARRAY coalesce(v_case_refs,'{}'::bigint[]) LOOP
      SELECT item_type,lifecycle_status,source,valid_from,valid_to INTO
        v_ref_type,v_ref_status,v_ref_source,v_ref_valid_from,v_ref_valid_to
        FROM public.knowledge_items WHERE id=v_ref;
      IF NOT FOUND OR v_ref_type<>'case' OR v_ref_status<>'verified' OR nullif(btrim(v_ref_source),'') IS NULL OR
         (v_ref_valid_from IS NOT NULL AND v_ref_valid_from>v_now) OR
         (v_ref_valid_to IS NOT NULL AND v_ref_valid_to<v_now) THEN
        RAISE EXCEPTION 'CASE_REFERENCE_INVALID' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOREACH v_ref IN ARRAY coalesce(v_story_refs,'{}'::bigint[]) LOOP
      SELECT item_type,lifecycle_status,source,valid_from,valid_to INTO
        v_ref_type,v_ref_status,v_ref_source,v_ref_valid_from,v_ref_valid_to
        FROM public.knowledge_items WHERE id=v_ref;
      IF NOT FOUND OR v_ref_type<>'story' OR v_ref_status<>'verified' OR nullif(btrim(v_ref_source),'') IS NULL OR
         (v_ref_valid_from IS NOT NULL AND v_ref_valid_from>v_now) OR
         (v_ref_valid_to IS NOT NULL AND v_ref_valid_to<v_now) THEN
        RAISE EXCEPTION 'STORY_REFERENCE_INVALID' USING ERRCODE='23514';
      END IF;
    END LOOP;
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
      UPDATE public.playbooks SET lifecycle_status='superseded',
        updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=v_supersedes_id;
    END IF;
  END IF;

  IF p_table='knowledge_items' THEN
    UPDATE public.knowledge_items SET lifecycle_status='verified',verified=true,
      verified_by=p_actor_uid,updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
  ELSE
    UPDATE public.playbooks SET lifecycle_status='verified',
      verified_by=p_actor_uid,updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'table',p_table,'status','verified');
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz) IS
  'PC22 service-only transaction for verification/invalidation and revision publication';
COMMENT ON COLUMN public.knowledge_items.lifecycle_status IS
  'Governance state; only verified items with verified=true can enter reliable evidence';
COMMENT ON COLUMN public.playbooks.evidence_refs IS
  'IDs must resolve to active, verified public.knowledge_items of type evidence at review and read time';
COMMIT;
