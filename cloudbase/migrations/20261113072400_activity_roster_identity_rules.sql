BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.crm_activity_roster_v1(p_actor text,p_op text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE aid bigint:=nullif(p_input->>'activityId','')::bigint; rid bigint:=nullif(p_input->>'id','')::bigint;
 c public.activity_roster_commands%ROWTYPE; profile public.activity_roster_people%ROWTYPE;
 plan jsonb; row_data jsonb; vals jsonb; response jsonb; relevant jsonb; n integer:=0; added integer:=0;
 pid bigint; person_ver text; key_name text; made bigint[]:=ARRAY[]::bigint[]; created_person jsonb; updated_count integer:=0;
 page_num integer:=greatest(1,least(100000,coalesce((p_input->>'page')::int,1))); term text:=lower(trim(coalesce(p_input->>'term','')));
BEGIN
 IF current_user<>'service_role' OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'ROSTER_DENIED'; END IF;
 IF p_op='facts' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO response FROM (
   SELECT m.id,m.activity_id,m.canonical_person_id,v.display_name AS person_name,m.status,m.participant_role,m.followup_status,m.created_at,m.updated_at,
    CASE WHEN c."Id" IS NOT NULL THEN 'customer' WHEN rc.id IS NOT NULL THEN 'recruit' WHEN sp.id IS NOT NULL THEN 'speaker' ELSE 'attendee' END AS person_type,
    coalesce(c."Id",rc.id,sp.id) AS person_id,c."Id" AS customer_id,rc.id AS recruit_id,sp.id AS speaker_id
   FROM public.activity_participants m JOIN public.v_activity_roster_people v ON v.id=m.roster_id JOIN public.activities a ON a.id=m.activity_id AND a.deleted_at IS NULL
   LEFT JOIN LATERAL(SELECT "Id" FROM public.customers WHERE person_id=m.canonical_person_id AND deleted_at IS NULL ORDER BY "Id" LIMIT 1)c ON true
   LEFT JOIN LATERAL(SELECT id FROM public.recruit_candidates WHERE person_id=m.canonical_person_id AND deleted_at IS NULL ORDER BY id LIMIT 1)rc ON true
   LEFT JOIN LATERAL(SELECT id FROM public.activity_speakers WHERE person_id=m.canonical_person_id AND deleted_at IS NULL ORDER BY id LIMIT 1)sp ON true
   WHERE m.deleted_at IS NULL AND (
     (p_input?'activityIds' AND m.activity_id IN (SELECT value::bigint FROM jsonb_array_elements_text(p_input->'activityIds')))
     OR (p_input->>'personType'='customer' AND c."Id"=(p_input->>'legacyId')::bigint) OR (p_input->>'personType'='recruit' AND rc.id=(p_input->>'legacyId')::bigint)
     OR (p_input->>'personType'='speaker' AND sp.id=(p_input->>'legacyId')::bigint)
     OR (p_input?'since' AND a.activity_date>=(p_input->>'since')::date)
   ) AND m.id>coalesce((p_input->>'after')::bigint,0) ORDER BY m.id LIMIT 201) x;
  RETURN jsonb_build_object('rows',response);
 END IF;
 IF p_op='list' OR p_op='personHistory' OR p_op='history' THEN
  IF p_op='list' THEN
   SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)-'total_rows' ORDER BY x.display_name,x.id),'[]'),'total',coalesce(max(x.total_rows),0)) INTO response FROM (
    SELECT v.*,k.times,k.latest,count(*) OVER() total_rows FROM public.v_activity_roster_people v
    CROSS JOIN LATERAL (SELECT count(*) times,max(a.activity_date) latest FROM public.activity_participants m JOIN public.activities a ON a.id=m.activity_id AND a.deleted_at IS NULL WHERE m.roster_id=v.id AND m.deleted_at IS NULL) k
    WHERE (aid IS NULL OR EXISTS(SELECT FROM public.activity_participants m JOIN public.activities a ON a.id=m.activity_id AND a.deleted_at IS NULL WHERE m.activity_id=aid AND m.roster_id=v.id AND m.deleted_at IS NULL))
    AND (term='' OR strpos(lower(concat_ws(' ',v.display_name,v.organization,v.school,v.phone,v.wechat)),term)>0)
    AND (coalesce(p_input->>'filter','') NOT IN ('linked','unlinked') OR (v.person_id IS NOT NULL)=(p_input->>'filter'='linked'))
    ORDER BY v.display_name,v.id LIMIT 50 OFFSET (page_num-1)*50) x;
   RETURN response||jsonb_build_object('imported',EXISTS(SELECT FROM public.activity_roster_commands WHERE activity_id=aid AND completed_at IS NOT NULL AND operation='import'));
  END IF;
  IF p_op='personHistory' THEN SELECT id INTO rid FROM public.activity_roster_people WHERE person_id=(p_input->>'personId')::bigint; END IF;
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)-'total_rows' ORDER BY x.activity_date DESC NULLS LAST,x.id DESC),'[]'),'total',coalesce(max(total_rows),0)) INTO response FROM (
   SELECT a.id,a.name,a.activity_date,a.location,count(*) OVER() total_rows FROM public.activity_participants m JOIN public.activities a ON a.id=m.activity_id AND a.deleted_at IS NULL
   WHERE m.roster_id=rid AND m.deleted_at IS NULL ORDER BY a.activity_date DESC NULLS LAST,a.id DESC LIMIT 50 OFFSET (page_num-1)*50) x;
  RETURN response;
 END IF;
 IF p_op='profile' THEN SELECT to_jsonb(v) INTO response FROM public.v_activity_roster_people v WHERE v.id=rid; RETURN response; END IF;
 IF p_op='lookup' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.display_name,v.id),'[]') INTO relevant FROM public.v_activity_roster_people v WHERE v.name_key IN (SELECT jsonb_array_elements_text(p_input->'keys'));
  RETURN jsonb_build_object('profiles',relevant,'persons',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM
   (SELECT DISTINCT x.id,x.display_name,x.name_key,x.organization,x.occupation,x.phone,x.wechat,x.updated_at FROM public.persons x WHERE x.deleted_at IS NULL AND x.name_key IN (SELECT jsonb_array_elements_text(p_input->'keys'))) p));
 END IF;
 IF p_op='prepare' THEN
  IF p_input->>'operation' NOT IN ('import','edit','link','createPerson','unlink','remove') OR jsonb_typeof(p_input->'rows') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_input->'rows') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'ROSTER_INVALID'; END IF;
  IF p_input->>'operation' IN ('import','remove') AND NOT EXISTS(SELECT FROM public.activities WHERE id=aid AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ROSTER_ACTIVITY'; END IF;
  UPDATE public.activity_roster_commands SET payload='{}' WHERE completed_at IS NULL AND created_at<now()-interval '30 minutes' AND payload<>'{}';
  INSERT INTO public.activity_roster_commands(actor,operation,activity_id,payload) VALUES(p_actor,p_input->>'operation',aid,p_input-'activityId'-'operation') RETURNING id INTO c.id;
  SELECT count(*) INTO n FROM jsonb_array_elements(p_input->'rows') x WHERE EXISTS(SELECT FROM public.activity_participants m
    WHERE m.activity_id=aid AND m.deleted_at IS NULL AND (m.roster_id=(x->>'id')::bigint OR m.canonical_person_id=(x->>'personId')::bigint));
  RETURN jsonb_build_object('previewId',c.id,'rows',p_input->'rows','operation',p_input->>'operation','activityId',aid,'existing',n,'newCount',jsonb_array_length(p_input->'rows')-n);
 END IF;
 IF p_op<>'confirm' THEN RAISE EXCEPTION 'ROSTER_INVALID'; END IF;
 SELECT * INTO c FROM public.activity_roster_commands WHERE id=(p_input->>'previewId')::uuid AND actor=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROSTER_INVALID'; END IF;
 IF c.completed_at IS NOT NULL THEN RETURN c.result; END IF;
 IF c.created_at<clock_timestamp()-interval '30 minutes' THEN RAISE EXCEPTION 'ROSTER_EXPIRED'; END IF;
 aid:=c.activity_id;
 IF aid IS NOT NULL THEN PERFORM 1 FROM public.activities WHERE id=aid AND deleted_at IS NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'ROSTER_ACTIVITY'; END IF; END IF;
 FOR key_name IN SELECT DISTINCT e->>'name_key' FROM jsonb_array_elements(c.payload->'rows') e ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('activity-roster:'||key_name,0));
 END LOOP;
 FOR row_data IN SELECT * FROM jsonb_array_elements(c.payload->'rows') LOOP
  vals:=row_data->'values'; rid:=(row_data->>'id')::bigint; pid:=(row_data->>'personId')::bigint; key_name:=row_data->>'name_key';
  IF rid IS NOT NULL THEN
   SELECT * INTO profile FROM public.activity_roster_people WHERE id=rid FOR UPDATE;
   IF NOT FOUND OR profile.version IS DISTINCT FROM (row_data->>'version')::bigint THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
  END IF;
  IF pid IS NOT NULL THEN
   SELECT p.updated_at::text INTO person_ver FROM public.persons p WHERE p.id=pid AND p.deleted_at IS NULL AND p.name_key=key_name FOR SHARE;
   IF NOT FOUND OR person_ver::timestamptz IS DISTINCT FROM (row_data->>'personVersion')::timestamptz THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
  END IF;
  IF c.operation='import' AND row_data->>'choice'='different' THEN
   LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;
   created_person:=public.crm_person_list_transfer_create_v1(p_actor,coalesce(row_data->'renameExisting','[]'::jsonb),row_data->'newPerson');
   IF coalesce((created_person->>'ok')::boolean,false) IS NOT TRUE OR nullif(created_person->>'personId','') IS NULL THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
   pid:=(created_person->>'personId')::bigint;
   vals:=jsonb_set(vals,'{display_name}',to_jsonb(created_person->>'displayName'));
  END IF;
  IF c.operation='import' AND rid IS NULL AND pid IS NOT NULL THEN
   SELECT id INTO rid FROM public.activity_roster_people WHERE person_id=pid;
  END IF;
  IF c.operation='import' AND rid IS NULL THEN
   IF (SELECT count(*) FROM public.v_activity_roster_people WHERE name_key=key_name AND NOT (id=ANY(made)) AND NOT (id::text=ANY(ARRAY(SELECT jsonb_array_elements_text(row_data->'knownProfiles')))))>0
    THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
   IF EXISTS(SELECT FROM public.persons p WHERE p.name_key=key_name AND p.deleted_at IS NULL AND p.id IS DISTINCT FROM pid AND NOT (p.id::text=ANY(ARRAY(SELECT jsonb_array_elements_text(row_data->'knownPersons'))))) THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
   INSERT INTO public.activity_roster_people(person_id,display_name,name_key,school,wechat,phone,organization,industry,graduation_year,other_info)
   VALUES(pid,vals->>'display_name',key_name,vals->>'school',vals->>'wechat',vals->>'phone',vals->>'organization',vals->>'industry',nullif(vals->>'graduation_year','')::int,vals->>'other_info') RETURNING id INTO rid;
  END IF;
  IF c.operation='import' AND row_data->>'id' IS NULL THEN made:=array_append(made,rid); END IF;
  IF c.operation='edit' OR (c.operation='import' AND row_data->'changes'<>'{}'::jsonb) THEN
   plan:=CASE WHEN c.operation='edit' THEN vals ELSE row_data->'changes' END;
   UPDATE public.activity_roster_people r SET display_name=CASE WHEN r.person_id IS NULL THEN coalesce(plan->>'display_name',r.display_name) ELSE r.display_name END,
    name_key=CASE WHEN r.person_id IS NULL AND plan?'display_name' THEN key_name ELSE r.name_key END,
    school=coalesce(plan->>'school',r.school),wechat=CASE WHEN r.person_id IS NULL THEN coalesce(plan->>'wechat',r.wechat) ELSE r.wechat END,
    phone=CASE WHEN r.person_id IS NULL THEN coalesce(plan->>'phone',r.phone) ELSE r.phone END,
    organization=CASE WHEN r.person_id IS NULL THEN coalesce(plan->>'organization',r.organization) ELSE r.organization END,
    industry=coalesce(plan->>'industry',r.industry),graduation_year=CASE WHEN plan?'graduation_year' THEN nullif(plan->>'graduation_year','')::int ELSE r.graduation_year END,
    other_info=coalesce(plan->>'other_info',r.other_info),version=r.version+1,updated_at=now() WHERE r.id=rid;
   IF plan?'display_name' THEN UPDATE public.activity_participants m SET person_name=v.display_name,updated_at=now() FROM public.v_activity_roster_people v WHERE m.roster_id=rid AND v.id=rid AND m.person_name IS DISTINCT FROM v.display_name; END IF;
   updated_count:=updated_count+1;
  END IF;
  IF c.operation IN ('link','createPerson','unlink') THEN
   IF c.operation='createPerson' THEN
    IF profile.person_id IS NOT NULL THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
    LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS(SELECT FROM public.persons WHERE name_key=key_name AND deleted_at IS NULL) THEN
     created_person:=public.crm_person_list_transfer_create_v1(p_actor,'[]',jsonb_build_object('display_name',vals->>'display_name','name_key',key_name,'phone',profile.phone,'wechat',profile.wechat,'organization',profile.organization));
     pid:=(created_person->>'personId')::bigint;
    ELSE
     INSERT INTO public.persons(display_name,name_key,phone,wechat,organization) VALUES(vals->>'display_name',key_name,profile.phone,profile.wechat,profile.organization) RETURNING id INTO pid;
    END IF;
   END IF;
   IF c.operation<>'unlink' AND profile.person_id IS NOT NULL AND profile.person_id IS DISTINCT FROM pid THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
   IF c.operation<>'unlink' AND pid IS NULL THEN RAISE EXCEPTION 'ROSTER_INVALID'; END IF;
   IF EXISTS(SELECT FROM public.activity_roster_people WHERE person_id=pid AND id<>rid) THEN RAISE EXCEPTION 'ROSTER_ALREADY_LINKED'; END IF;
   UPDATE public.activity_roster_people SET person_id=pid,display_name=coalesce(vals->>'display_name',display_name),name_key=key_name,version=version+1,updated_at=now() WHERE id=rid;
   UPDATE public.activity_participants SET canonical_person_id=pid,person_name=vals->>'display_name',updated_at=now() WHERE roster_id=rid;
  ELSIF c.operation='import' THEN
   INSERT INTO public.activity_participants(activity_id,roster_id,canonical_person_id,person_type,person_name,status,participant_role)
    SELECT aid,r.id,r.person_id,'attendee',r.display_name,'attended','attendee' FROM public.v_activity_roster_people r WHERE r.id=rid
    ON CONFLICT (activity_id,roster_id) WHERE deleted_at IS NULL AND roster_id IS NOT NULL DO NOTHING;
   IF FOUND THEN added:=added+1; END IF;
  ELSIF c.operation='remove' THEN
   UPDATE public.activity_participants SET deleted_at=now(),updated_at=now() WHERE activity_id=aid AND roster_id=rid AND deleted_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'ROSTER_CONFLICT'; END IF;
  END IF;
  n:=n+1;
 END LOOP;
 IF aid IS NOT NULL THEN UPDATE public.activities SET actual_participants=(SELECT count(*) FROM public.activity_participants WHERE activity_id=aid AND roster_id IS NOT NULL AND deleted_at IS NULL) WHERE id=aid; END IF;
 response:=jsonb_build_object('processed',n,'added',added,'updated',updated_count,'id',rid,'personId',pid);
 UPDATE public.activity_roster_commands SET completed_at=now(),result=response,payload=jsonb_build_object('file',c.payload->>'file','rows',n) WHERE id=c.id;
 RETURN response;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_activity_roster_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_activity_roster_v1(text,text,jsonb) TO service_role;
COMMIT;

