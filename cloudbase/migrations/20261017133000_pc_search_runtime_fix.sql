-- PC24 runtime correction: match the verified production activity_speakers columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.crm_search_people_v2(
  p_filters jsonb, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_count integer := 0;
  v_value text;
  v_person_id bigint;
  v_result jsonb;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 500 THEN
    RAISE EXCEPTION 'Invalid combination search criteria' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS keys(key)
    WHERE key NOT IN ('roles','relationshipTypes','fact','attendanceMonths','followupState','followupMonths',
      'opportunityStatuses','opportunityTypes','recruitStages','personId')) THEN
    RAISE EXCEPTION 'Unsupported combination search field' USING ERRCODE = '22023';
  END IF;
  IF p_filters ? 'personId' THEN
    IF jsonb_typeof(p_filters->'personId') <> 'string' OR (p_filters->>'personId') !~ '^[1-9][0-9]{0,18}$' THEN
      RAISE EXCEPTION 'Invalid selected Person' USING ERRCODE = '22023';
    END IF;
    v_person_id := (p_filters->>'personId')::bigint;
  END IF;
  FOREACH v_value IN ARRAY ARRAY['roles','relationshipTypes','opportunityStatuses','opportunityTypes','recruitStages'] LOOP
    IF p_filters ? v_value AND jsonb_typeof(p_filters->v_value) <> 'null' THEN
      IF jsonb_typeof(p_filters->v_value) <> 'array' OR jsonb_array_length(p_filters->v_value) NOT BETWEEN 1 AND 6 THEN
        RAISE EXCEPTION 'Invalid array search condition' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT item FROM jsonb_array_elements_text(p_filters->v_value) AS items(item) GROUP BY item HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate search values' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_filters->v_value) AS items(item) WHERE
        CASE v_value
          WHEN 'roles' THEN item NOT IN ('customer','recruit','speaker','participant')
          WHEN 'relationshipTypes' THEN item NOT IN ('family','friend','colleague','business','referral','other')
          WHEN 'opportunityStatuses' THEN item NOT IN ('发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系','成交','关闭')
          WHEN 'opportunityTypes' THEN item NOT IN ('insurance','recruit','referral','activity','speaker','partnership','service','relationship','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍')
          ELSE item NOT IN ('新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司','流失','名单','接触','面谈1','面谈2','创说会','报考','入司','转正')
        END) THEN RAISE EXCEPTION 'Unsupported search value' USING ERRCODE = '22023'; END IF;
      IF v_value NOT IN ('opportunityStatuses','opportunityTypes') THEN v_count := v_count + 1; END IF;
    END IF;
  END LOOP;
  IF (p_filters ? 'opportunityStatuses' AND jsonb_typeof(p_filters->'opportunityStatuses')<>'null') OR
     (p_filters ? 'opportunityTypes' AND jsonb_typeof(p_filters->'opportunityTypes')<>'null') THEN v_count := v_count + 1; END IF;
  IF p_filters ? 'fact' AND jsonb_typeof(p_filters->'fact') <> 'null' THEN
    IF jsonb_typeof(p_filters->'fact') <> 'object' OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters->'fact') AS keys(key) WHERE key NOT IN ('category','contains')) OR
       coalesce(length(p_filters->'fact'->>'category'),0) > 64 OR coalesce(length(p_filters->'fact'->>'contains'),0) > 80 OR
       (nullif(btrim(p_filters->'fact'->>'category'),'') IS NULL AND nullif(btrim(p_filters->'fact'->>'contains'),'') IS NULL) OR
       strpos(coalesce(p_filters->'fact'->>'category',''),'%')>0 OR strpos(coalesce(p_filters->'fact'->>'category',''),'_')>0 OR strpos(coalesce(p_filters->'fact'->>'category',''),E'\\')>0 OR
       strpos(coalesce(p_filters->'fact'->>'contains',''),'%')>0 OR strpos(coalesce(p_filters->'fact'->>'contains',''),'_')>0 OR strpos(coalesce(p_filters->'fact'->>'contains',''),E'\\')>0 THEN
      RAISE EXCEPTION 'Invalid fact search condition' USING ERRCODE = '22023';
    END IF;
    v_count := v_count + 1;
  END IF;
  IF p_filters ? 'attendanceMonths' AND jsonb_typeof(p_filters->'attendanceMonths') <> 'null' THEN
    IF jsonb_typeof(p_filters->'attendanceMonths') <> 'number' OR (p_filters->>'attendanceMonths') !~ '^[0-9]+$' OR (p_filters->>'attendanceMonths')::integer NOT BETWEEN 1 AND 24 THEN
      RAISE EXCEPTION 'Invalid attendance window' USING ERRCODE = '22023'; END IF;
    v_count := v_count + 1;
  END IF;
  IF p_filters ? 'followupMonths' AND jsonb_typeof(p_filters->'followupMonths') <> 'null' THEN
    IF jsonb_typeof(p_filters->'followupMonths') <> 'number' OR (p_filters->>'followupMonths') !~ '^[0-9]+$' OR (p_filters->>'followupMonths')::integer NOT BETWEEN 1 AND 24 THEN
      RAISE EXCEPTION 'Invalid follow-up window' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_filters ? 'followupState' AND jsonb_typeof(p_filters->'followupState') <> 'null' THEN
    IF p_filters->>'followupState' NOT IN ('recent','none') OR
       NOT (p_filters ? 'followupMonths' AND jsonb_typeof(p_filters->'followupMonths')='number') THEN
      RAISE EXCEPTION 'Invalid follow-up condition' USING ERRCODE = '22023'; END IF;
    v_count := v_count + 1;
  ELSIF p_filters ? 'followupMonths' AND jsonb_typeof(p_filters->'followupMonths') <> 'null' THEN
    RAISE EXCEPTION 'Follow-up window requires follow-up state' USING ERRCODE = '22023';
  END IF;
  IF v_count NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Search requires 1 to 7 condition groups' USING ERRCODE = '22023'; END IF;

  WITH matched AS (
    SELECT p.id AS person_id, p.display_name,
      c."Id" AS customer_id,
      (SELECT jsonb_agg(jsonb_build_object('id',x.id,'type',x.relationship_type,'confirmedAt',x.confirmed_at)
        ORDER BY x.confirmed_at DESC,x.id DESC)
       FROM public.relationships x WHERE x.deleted_at IS NULL AND x.status='confirmed' AND x.confirmed_at IS NOT NULL
        AND (x.from_person_id=p.id OR x.to_person_id=p.id)
        AND EXISTS(SELECT 1 FROM public.persons endpoint WHERE endpoint.id=CASE WHEN x.from_person_id=p.id THEN x.to_person_id ELSE x.from_person_id END AND endpoint.deleted_at IS NULL)
        AND (NOT (p_filters ? 'relationshipTypes') OR jsonb_typeof(p_filters->'relationshipTypes')='null'
          OR x.relationship_type IN (SELECT jsonb_array_elements_text(p_filters->'relationshipTypes')))) AS relationships,
      (SELECT jsonb_agg(jsonb_build_object('participantId',ap.id,'activityId',a.id,'date',a.activity_date)
        ORDER BY a.activity_date DESC,ap.id DESC)
       FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id
       WHERE ap.deleted_at IS NULL AND a.deleted_at IS NULL AND ap.status='attended'
        AND (NOT (p_filters ? 'attendanceMonths') OR jsonb_typeof(p_filters->'attendanceMonths')='null' OR
          (a.activity_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'attendanceMonths')::int) AND a.activity_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date))
        AND (ap.canonical_person_id=p.id OR (ap.canonical_person_id IS NULL AND
          ((ap.person_type='person' AND ap.person_id=p.id) OR
           (ap.person_type='customer' AND ap.person_id=c."Id") OR
           (ap.person_type='recruit' AND EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.id=ap.person_id AND rc.person_id=p.id AND rc.deleted_at IS NULL)))))) AS attendance,
      (SELECT jsonb_agg(jsonb_build_object('id',ci.id,'category',ci.category,'content',ci.content,'verifiedAt',ci.last_verified_at)
        ORDER BY ci.last_verified_at DESC NULLS LAST,ci.id DESC)
       FROM public.context_items ci WHERE ci.person_id=p.id AND ci.item_type='fact' AND ci.confirmed
        AND (ci.valid_from IS NULL OR ci.valid_from<=now()) AND (ci.valid_to IS NULL OR ci.valid_to>=now())
        AND (NOT (p_filters ? 'fact') OR jsonb_typeof(p_filters->'fact')='null' OR
          ((nullif(p_filters->'fact'->>'category','') IS NULL OR ci.category=p_filters->'fact'->>'category') AND
           (nullif(p_filters->'fact'->>'contains','') IS NULL OR ci.content ILIKE ('%'||(p_filters->'fact'->>'contains')||'%'))))
        AND NOT EXISTS (SELECT 1 FROM public.context_items competing WHERE competing.person_id=ci.person_id
          AND competing.item_type='fact' AND competing.confirmed AND competing.category=ci.category
          AND competing.content IS DISTINCT FROM ci.content
          AND (competing.valid_from IS NULL OR competing.valid_from<=now())
          AND (competing.valid_to IS NULL OR competing.valid_to>=now()))) AS facts,
      (SELECT jsonb_agg(jsonb_build_object('id',f."Id",'date',f.followup_date,'kind','customer') ORDER BY f.followup_date DESC,f."Id" DESC)
       FROM public.followups f WHERE f.customer_id=c."Id" AND f.deleted_at IS NULL
         AND f.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(months => coalesce((p_filters->>'followupMonths')::int,24))) AS customer_followups,
      (SELECT jsonb_agg(jsonb_build_object('id',rf.id,'date',rf.followup_date,'kind','recruit') ORDER BY rf.followup_date DESC,rf.id DESC)
       FROM public.recruit_followups rf JOIN public.recruit_candidates rc ON rc.id=rf.candidate_id
       WHERE rc.person_id=p.id AND rc.deleted_at IS NULL AND rf.deleted_at IS NULL
         AND rf.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(months => coalesce((p_filters->>'followupMonths')::int,24))) AS recruit_followups,
      (SELECT jsonb_agg(jsonb_build_object('id',o.id,'type',o.opportunity_type,'status',o.status) ORDER BY o.updated_at DESC,o.id DESC)
       FROM public.opportunities o WHERE o.deleted_at IS NULL AND (o.person_id=p.id OR o.customer_id=c."Id")
        AND (NOT (p_filters ? 'opportunityStatuses') OR jsonb_typeof(p_filters->'opportunityStatuses')='null' OR o.status IN (SELECT jsonb_array_elements_text(p_filters->'opportunityStatuses')))
        AND (NOT (p_filters ? 'opportunityTypes') OR jsonb_typeof(p_filters->'opportunityTypes')='null' OR o.opportunity_type IN (SELECT jsonb_array_elements_text(p_filters->'opportunityTypes')))) AS opportunities,
      (SELECT jsonb_agg(jsonb_build_object('id',rc.id,'stage',rc.stage) ORDER BY rc.updated_at DESC,rc.id DESC)
       FROM public.recruit_candidates rc WHERE rc.person_id=p.id AND rc.deleted_at IS NULL
        AND (NOT (p_filters ? 'recruitStages') OR jsonb_typeof(p_filters->'recruitStages')='null' OR rc.stage IN (SELECT jsonb_array_elements_text(p_filters->'recruitStages')))) AS recruits,
      (SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.updated_at DESC,s.id DESC)
       FROM public.activity_speakers s WHERE s.deleted_at IS NULL AND s.status='active'
        AND (s.person_id=p.id OR s.customer_id=c."Id" OR EXISTS(SELECT 1 FROM public.recruit_candidates sr WHERE sr.id=s.recruit_candidate_id AND sr.person_id=p.id AND sr.deleted_at IS NULL))) AS speakers
    FROM public.persons p
    LEFT JOIN public.customers c ON c.person_id=p.id AND c.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND (v_person_id IS NULL OR p.id=v_person_id)
      AND (NOT (p_filters ? 'roles') OR jsonb_typeof(p_filters->'roles')='null' OR
        ((('customer'=ANY(SELECT jsonb_array_elements_text(p_filters->'roles'))) AND c."Id" IS NOT NULL) OR
         (('recruit'=ANY(SELECT jsonb_array_elements_text(p_filters->'roles'))) AND EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.person_id=p.id AND rc.deleted_at IS NULL)) OR
         (('speaker'=ANY(SELECT jsonb_array_elements_text(p_filters->'roles'))) AND EXISTS(SELECT 1 FROM public.activity_speakers s WHERE s.deleted_at IS NULL AND s.status='active' AND (s.person_id=p.id OR s.customer_id=c."Id" OR EXISTS(SELECT 1 FROM public.recruit_candidates sr WHERE sr.id=s.recruit_candidate_id AND sr.person_id=p.id AND sr.deleted_at IS NULL)))) OR
         (('participant'=ANY(SELECT jsonb_array_elements_text(p_filters->'roles'))) AND EXISTS(SELECT 1 FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id WHERE ap.deleted_at IS NULL AND a.deleted_at IS NULL AND (ap.canonical_person_id=p.id OR (ap.canonical_person_id IS NULL AND ((ap.person_type='person' AND ap.person_id=p.id) OR (ap.person_type='customer' AND ap.person_id=c."Id") OR (ap.person_type='recruit' AND EXISTS(SELECT 1 FROM public.recruit_candidates rp WHERE rp.id=ap.person_id AND rp.person_id=p.id AND rp.deleted_at IS NULL)))))))))
      AND (NOT (p_filters ? 'relationshipTypes') OR jsonb_typeof(p_filters->'relationshipTypes')='null' OR EXISTS(SELECT 1 FROM public.relationships x WHERE x.deleted_at IS NULL AND x.status='confirmed' AND x.confirmed_at IS NOT NULL AND (x.from_person_id=p.id OR x.to_person_id=p.id) AND EXISTS(SELECT 1 FROM public.persons endpoint WHERE endpoint.id=CASE WHEN x.from_person_id=p.id THEN x.to_person_id ELSE x.from_person_id END AND endpoint.deleted_at IS NULL) AND x.relationship_type IN (SELECT jsonb_array_elements_text(p_filters->'relationshipTypes'))))
      AND (NOT (p_filters ? 'fact') OR jsonb_typeof(p_filters->'fact')='null' OR EXISTS(SELECT 1 FROM public.context_items ci WHERE ci.person_id=p.id AND ci.item_type='fact' AND ci.confirmed AND (ci.valid_from IS NULL OR ci.valid_from<=now()) AND (ci.valid_to IS NULL OR ci.valid_to>=now()) AND NOT EXISTS(SELECT 1 FROM public.context_items competing WHERE competing.person_id=ci.person_id AND competing.item_type='fact' AND competing.confirmed AND competing.category=ci.category AND competing.content IS DISTINCT FROM ci.content AND (competing.valid_from IS NULL OR competing.valid_from<=now()) AND (competing.valid_to IS NULL OR competing.valid_to>=now())) AND (nullif(p_filters->'fact'->>'category','') IS NULL OR ci.category=p_filters->'fact'->>'category') AND (nullif(p_filters->'fact'->>'contains','') IS NULL OR ci.content ILIKE ('%'||(p_filters->'fact'->>'contains')||'%'))))
      AND (NOT (p_filters ? 'attendanceMonths') OR jsonb_typeof(p_filters->'attendanceMonths')='null' OR EXISTS(SELECT 1 FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id WHERE ap.deleted_at IS NULL AND a.deleted_at IS NULL AND ap.status='attended' AND a.activity_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'attendanceMonths')::int) AND a.activity_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date AND (ap.canonical_person_id=p.id OR (ap.canonical_person_id IS NULL AND ((ap.person_type='person' AND ap.person_id=p.id) OR (ap.person_type='customer' AND ap.person_id=c."Id") OR (ap.person_type='recruit' AND EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.id=ap.person_id AND rc.person_id=p.id AND rc.deleted_at IS NULL)))))))
      AND (NOT (p_filters ? 'followupState') OR jsonb_typeof(p_filters->'followupState')='null' OR
        CASE p_filters->>'followupState'
          WHEN 'recent' THEN (EXISTS(SELECT 1 FROM public.followups f WHERE f.customer_id=c."Id" AND f.deleted_at IS NULL AND f.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'followupMonths')::int)) OR EXISTS(SELECT 1 FROM public.recruit_followups rf JOIN public.recruit_candidates rc ON rc.id=rf.candidate_id WHERE rc.person_id=p.id AND rc.deleted_at IS NULL AND rf.deleted_at IS NULL AND rf.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'followupMonths')::int)))
          ELSE NOT EXISTS(SELECT 1 FROM public.followups f WHERE f.customer_id=c."Id" AND f.deleted_at IS NULL AND f.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'followupMonths')::int)) AND NOT EXISTS(SELECT 1 FROM public.recruit_followups rf JOIN public.recruit_candidates rc ON rc.id=rf.candidate_id WHERE rc.person_id=p.id AND rc.deleted_at IS NULL AND rf.deleted_at IS NULL AND rf.followup_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-make_interval(months=>(p_filters->>'followupMonths')::int))
        END)
      AND (NOT (p_filters ? 'opportunityStatuses') OR jsonb_typeof(p_filters->'opportunityStatuses')='null' OR EXISTS(SELECT 1 FROM public.opportunities o WHERE o.deleted_at IS NULL AND (o.person_id=p.id OR o.customer_id=c."Id") AND o.status IN (SELECT jsonb_array_elements_text(p_filters->'opportunityStatuses'))))
      AND (NOT (p_filters ? 'opportunityTypes') OR jsonb_typeof(p_filters->'opportunityTypes')='null' OR EXISTS(SELECT 1 FROM public.opportunities o WHERE o.deleted_at IS NULL AND (o.person_id=p.id OR o.customer_id=c."Id") AND o.opportunity_type IN (SELECT jsonb_array_elements_text(p_filters->'opportunityTypes'))))
      AND (NOT (p_filters ? 'recruitStages') OR jsonb_typeof(p_filters->'recruitStages')='null' OR EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.person_id=p.id AND rc.deleted_at IS NULL AND rc.stage IN (SELECT jsonb_array_elements_text(p_filters->'recruitStages'))))
  ), page_rows AS (
    SELECT * FROM matched ORDER BY display_name COLLATE "C", person_id LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('person_id',person_id,'display_name',display_name,'customer_id',customer_id,
      'relationships',relationships,'attendance',attendance,'facts',facts,'customer_followups',customer_followups,
      'recruit_followups',recruit_followups,'opportunities',opportunities,'recruits',recruits,'speakers',speakers,
      'sources',jsonb_build_object('persons',jsonb_build_array(person_id),
        'customers',CASE WHEN customer_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(customer_id) END,
        'relationships',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(relationships,'[]'::jsonb)) x),'[]'::jsonb),
        'activity_participants',coalesce((SELECT jsonb_agg(x->>'participantId') FROM jsonb_array_elements(coalesce(attendance,'[]'::jsonb)) x),'[]'::jsonb),
        'activities',coalesce((SELECT jsonb_agg(x->>'activityId') FROM jsonb_array_elements(coalesce(attendance,'[]'::jsonb)) x),'[]'::jsonb),
        'context_items',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(facts,'[]'::jsonb)) x),'[]'::jsonb),
        'followups',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(customer_followups,'[]'::jsonb)) x),'[]'::jsonb),
        'recruit_followups',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(recruit_followups,'[]'::jsonb)) x),'[]'::jsonb),
        'opportunities',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(opportunities,'[]'::jsonb)) x),'[]'::jsonb),
        'recruit_candidates',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(recruits,'[]'::jsonb)) x),'[]'::jsonb),
        'activity_speakers',coalesce((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(coalesce(speakers,'[]'::jsonb)) x),'[]'::jsonb))
      ) ORDER BY display_name COLLATE "C",person_id) FROM page_rows),'[]'::jsonb),
    'filterLabels',coalesce((SELECT jsonb_agg(key) FROM jsonb_object_keys(p_filters) AS keys(key) WHERE key<>'personId' AND jsonb_typeof(p_filters->key)<>'null'),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_search_people_v2(jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_search_people_v2(jsonb,integer,integer) TO service_role;
COMMENT ON FUNCTION public.crm_search_people_v2(jsonb,integer,integer) IS
  'PC24 fixed, read-only combination search. Accepts allowlisted JSON filters only; returns active public CRM records and source references.';
COMMIT;
