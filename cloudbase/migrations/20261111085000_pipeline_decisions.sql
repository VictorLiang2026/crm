BEGIN;
CREATE TABLE public.crm_pipeline_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL,
  request_id uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id),
  protection_id bigint REFERENCES public.opportunities(id),
  recruit_id bigint REFERENCES public.recruit_candidates(id),
  prior_id uuid REFERENCES public.crm_pipeline_decisions(id),
  person_version timestamptz,
  record_version timestamptz,
  stage text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL CHECK (source IN ('','referral')),
  native_after text,
  preview jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
  confirmed_at timestamptz,
  UNIQUE(actor_uid,request_id),
  CHECK (num_nonnulls(protection_id,recruit_id)=1)
);
CREATE INDEX crm_pipeline_last_protection ON public.crm_pipeline_decisions(protection_id,confirmed_at DESC)
  WHERE confirmed_at IS NOT NULL AND protection_id IS NOT NULL;
CREATE INDEX crm_pipeline_last_recruit ON public.crm_pipeline_decisions(recruit_id,confirmed_at DESC)
  WHERE confirmed_at IS NOT NULL AND recruit_id IS NOT NULL;
ALTER TABLE public.crm_pipeline_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_pipeline_decisions_service_only ON public.crm_pipeline_decisions FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.crm_pipeline_decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_pipeline_decisions TO service_role;

CREATE FUNCTION public.crm_pipeline_stage_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $stage$
DECLARE
  cmd public.crm_pipeline_decisions%ROWTYPE;
  prev public.crm_pipeline_decisions%ROWTYPE;
  target_person bigint;
  target_record bigint;
  track text;
  requested text;
  note text;
  origin text;
  key uuid;
  person_version timestamptz;
  record_version timestamptz;
  person_name text;
  raw_stage text;
  before_stage text;
  native_after text;
  terminal boolean;
  decision_time timestamptz;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR length(p_actor_uid)>128
     OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Unauthorized pipeline command'; END IF;
  IF p_operation='confirm' THEN
    IF p_data - 'previewId' <> '{}'::jsonb THEN RAISE EXCEPTION 'Invalid confirmation'; END IF;
    SELECT * INTO STRICT cmd FROM public.crm_pipeline_decisions WHERE id=(p_data->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
    IF cmd.confirmed_at IS NOT NULL THEN RETURN jsonb_build_object('stage',cmd.stage,'confirmedAt',cmd.confirmed_at,'replayed',true); END IF;
    IF cmd.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Pipeline preview expired'; END IF;
    target_person:=cmd.person_id;target_record:=coalesce(cmd.recruit_id,cmd.protection_id);
    track:=CASE WHEN cmd.recruit_id IS NULL THEN 'protection' ELSE 'recruitment' END;
    requested:=cmd.stage;note:=cmd.reason;origin:=cmd.source;
  ELSIF p_operation='preview' THEN
    IF p_data - ARRAY['personId','recordId','track','stage','reason','source','requestId'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unexpected pipeline input'; END IF;
    target_person:=(p_data->>'personId')::bigint;target_record:=(p_data->>'recordId')::bigint;
    track:=p_data->>'track';requested:=p_data->>'stage';note:=btrim(coalesce(p_data->>'reason',''));
    origin:=coalesce(p_data->>'source','');key:=(p_data->>'requestId')::uuid;
    IF key IS NULL OR requested IS NULL OR origin NOT IN ('','referral') OR length(note)>4000 OR track IS NULL OR track NOT IN ('protection','recruitment')
      OR (track='protection' AND requested NOT IN ('需求线索','需求已核实','保障分析','方案沟通','等待决定','已成交','暂缓','未达成'))
      OR (track='recruitment' AND requested NOT IN ('关系建立','兴趣了解','双向评估','职业沟通','决策跟进','已加入','继续培养','暂不推进'))
      THEN RAISE EXCEPTION 'Invalid pipeline stage'; END IF;
  ELSIF p_operation='state' THEN
    IF p_data - ARRAY['personId','recordId','track'] <> '{}'::jsonb OR coalesce(p_data->>'track','') NOT IN ('protection','recruitment') THEN
      RAISE EXCEPTION 'Invalid state request'; END IF;
    track:=p_data->>'track';target_person:=(p_data->>'personId')::bigint;target_record:=(p_data->>'recordId')::bigint;
  ELSE RAISE EXCEPTION 'Invalid operation'; END IF;
  terminal:=requested IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进');
  IF terminal AND note='' THEN RAISE EXCEPTION 'Outcome reason required'; END IF;
  IF p_operation='confirm' THEN
    PERFORM 1 FROM public.persons WHERE id=target_person AND deleted_at IS NULL FOR SHARE;
    IF track='recruitment' THEN
      PERFORM 1 FROM public.recruit_candidates WHERE id=target_record AND person_id=target_person AND deleted_at IS NULL FOR UPDATE;
    ELSE
      PERFORM 1 FROM public.opportunities WHERE id=target_record AND deleted_at IS NULL FOR UPDATE;
    END IF;
  END IF;
  SELECT p.display_name,p.updated_at INTO STRICT person_name,person_version FROM public.persons p
    WHERE p.id=target_person AND p.deleted_at IS NULL;
  IF p_operation<>'state' AND EXISTS (SELECT 1 FROM public.crm_test_batches b WHERE b.created_by_uid=p_actor_uid)
    AND NOT EXISTS (
      SELECT 1 FROM public.crm_test_batches b JOIN public.crm_test_records person_ref ON person_ref.batch_key=b.batch_key
      JOIN public.crm_test_records target_ref ON target_ref.batch_key=b.batch_key
      WHERE b.created_by_uid=p_actor_uid AND person_ref.record_table='persons' AND person_ref.record_id=target_person::text
        AND target_ref.record_table=CASE WHEN track='recruitment' THEN 'recruit_candidates' ELSE 'opportunities' END
        AND target_ref.record_id=target_record::text
    ) THEN RAISE EXCEPTION 'Test account requires tracked target'; END IF;
  IF track='recruitment' THEN
    SELECT r.stage,r.updated_at INTO STRICT raw_stage,record_version FROM public.recruit_candidates r
      WHERE r.id=target_record AND r.person_id=target_person AND r.deleted_at IS NULL;
  ELSE
    SELECT o.status,o.updated_at INTO STRICT raw_stage,record_version FROM public.opportunities o
      LEFT JOIN public.customers c ON c."Id"=o.customer_id AND c.deleted_at IS NULL
      WHERE o.id=target_record AND o.deleted_at IS NULL AND coalesce(o.person_id,c.person_id)=target_person
        AND (o.customer_id IS NULL OR c.person_id=target_person) AND o.opportunity_type IN ('insurance','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障');
  END IF;
  SELECT d.* INTO prev FROM public.crm_pipeline_decisions d WHERE d.confirmed_at IS NOT NULL
    AND d.person_id=target_person AND ((track='protection' AND d.protection_id=target_record) OR (track='recruitment' AND d.recruit_id=target_record))
    ORDER BY d.confirmed_at DESC,d.id DESC LIMIT 1;
  before_stage:=CASE WHEN prev.id IS NOT NULL AND (track='recruitment' OR prev.native_after=raw_stage) THEN prev.stage
    WHEN track='protection' AND raw_stage='发现' THEN '需求线索'
    WHEN track='protection' AND raw_stage='成交' THEN '已成交'
    WHEN track='recruitment' AND raw_stage='签约入司' THEN '已加入' ELSE raw_stage END;
  IF p_operation='state' THEN
    RETURN jsonb_build_object('stage',before_stage,'nativeStage',raw_stage,'source',coalesce(prev.source,''),
      'confirmedAt',prev.confirmed_at,'reason',prev.reason);
  END IF;
  native_after:=CASE WHEN track='recruitment' THEN raw_stage WHEN requested='已成交' THEN '成交'
    WHEN terminal THEN '关闭' WHEN requested='需求线索' THEN '发现'
    WHEN requested IN ('方案沟通','等待决定') THEN '方案' ELSE '沟通' END;
  IF p_operation='preview' THEN
    INSERT INTO public.crm_pipeline_decisions(actor_uid,request_id,person_id,protection_id,recruit_id,prior_id,
      person_version,record_version,stage,reason,source,native_after,preview)
    VALUES(p_actor_uid,key,target_person,CASE WHEN track='protection' THEN target_record END,
      CASE WHEN track='recruitment' THEN target_record END,prev.id,person_version,record_version,requested,note,origin,native_after,
      jsonb_build_object('track',track,'recordId',target_record,'personId',target_person,'personName',person_name,'before',before_stage,
        'stage',requested,'reason',note,'source',origin,'terminal',terminal,'milestoneWritten',false))
    ON CONFLICT(actor_uid,request_id) DO NOTHING RETURNING * INTO cmd;
    IF NOT FOUND THEN
      SELECT * INTO STRICT cmd FROM public.crm_pipeline_decisions WHERE actor_uid=p_actor_uid AND request_id=key;
      IF cmd.person_id<>target_person OR coalesce(cmd.recruit_id,cmd.protection_id)<>target_record OR cmd.preview->>'track'<>track
        OR cmd.stage<>requested OR cmd.reason<>note OR cmd.source<>origin THEN RAISE EXCEPTION 'Request ID reused'; END IF;
    END IF;
    RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at);
  END IF;
  IF cmd.prior_id IS DISTINCT FROM prev.id OR cmd.record_version IS DISTINCT FROM record_version OR cmd.person_version IS DISTINCT FROM person_version
     OR cmd.preview->>'before' IS DISTINCT FROM before_stage THEN RAISE EXCEPTION 'Pipeline record changed; preview again'; END IF;
  decision_time:=clock_timestamp();
  IF track='protection' THEN
    UPDATE public.opportunities SET status=native_after,updated_at=decision_time WHERE id=target_record;
    IF terminal AND before_stage IS DISTINCT FROM requested THEN
      INSERT INTO public.outcomes(opportunity_id,outcome_type,result,occurred_at)
        VALUES(target_record,CASE WHEN requested='已成交' THEN 'opportunity_sale' ELSE 'opportunity_closed' END,note,decision_time);
    END IF;
  END IF;
  UPDATE public.crm_pipeline_decisions SET confirmed_at=decision_time WHERE id=cmd.id;
  RETURN jsonb_build_object('stage',requested,'confirmedAt',decision_time,'replayed',false);
END
$stage$;
REVOKE ALL ON FUNCTION public.crm_pipeline_stage_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_stage_v1(text,text,jsonb) TO service_role;
COMMIT;
