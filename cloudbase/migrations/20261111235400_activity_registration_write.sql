BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.crm_activity_registration_write_v1(p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  pgrow public.activity_registration_pages%ROWTYPE;
  sub public.activity_registration_submissions%ROWTYPE;
  link public.activity_registration_people%ROWTYPE;
  actor text:=nullif(btrim(p_data->>'actor'),'');
  h text:=p_data->>'hash'; next_hash text:=p_data->>'newHash'; new_status text:=p_data->>'status';
  person_key bigint; stamp timestamptz:=clock_timestamp();
BEGIN
  IF p_operation IN ('submit','rotate') THEN
    IF p_operation='rotate' THEN
      SELECT management_token_hash INTO h FROM public.activity_registration_submissions WHERE id=(p_data->>'id')::uuid;
    END IF;
    IF h IS NULL OR h !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('registration:'||h,0));
  END IF;
  IF p_operation='submit' THEN
    SELECT p.* INTO pgrow FROM public.activity_registration_pages p JOIN public.activities a ON a.id=p.activity_id
      WHERE p.id=(p_data->>'pageId')::uuid AND p.status='published' AND a.deleted_at IS NULL FOR UPDATE OF p FOR SHARE OF a;
    IF NOT FOUND OR pgrow.form_schema IS DISTINCT FROM p_data->'schema' THEN RAISE EXCEPTION 'PAGE_UNAVAILABLE'; END IF;
    IF (p_data->>'reuse')::boolean AND NOT EXISTS(SELECT FROM public.activity_registration_submissions
      WHERE management_token_hash=h AND status<>'withdrawn') THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    IF EXISTS(SELECT FROM public.activity_registration_submissions WHERE page_id=pgrow.id AND management_token_hash=h AND status<>'withdrawn')
      THEN RAISE EXCEPTION 'ALREADY_REGISTERED'; END IF;
    IF pgrow.capacity IS NOT NULL AND (SELECT count(*) FROM public.activity_registration_submissions
       WHERE page_id=pgrow.id AND status IN ('pending','approved','waitlisted'))>=pgrow.capacity THEN RAISE EXCEPTION 'REGISTRATION_FULL'; END IF;
    INSERT INTO public.activity_registration_submissions(page_id,attendee_name,phone,wechat,answers,management_token_hash)
      VALUES(pgrow.id,p_data->>'name',nullif(p_data->>'phone',''),nullif(p_data->>'wechat',''),p_data->'answers',h) RETURNING * INTO sub;
    INSERT INTO public.activity_registration_audit(submission_id,action) VALUES(sub.id,'submitted');
    RETURN jsonb_build_object('submissionId',sub.id);
  END IF;

  SELECT * INTO sub FROM public.activity_registration_submissions WHERE id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
  IF p_operation='edit' THEN
    IF h IS DISTINCT FROM sub.management_token_hash OR sub.status='withdrawn' THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    IF sub.status NOT IN ('pending','waitlisted') THEN RAISE EXCEPTION 'REGISTRATION_LOCKED'; END IF;
    SELECT * INTO STRICT pgrow FROM public.activity_registration_pages WHERE id=sub.page_id FOR SHARE;
    IF pgrow.form_schema IS DISTINCT FROM p_data->'schema' THEN RAISE EXCEPTION 'FORM_INVALID'; END IF;
    UPDATE public.activity_registration_submissions SET attendee_name=p_data->>'name',phone=nullif(p_data->>'phone',''),
      wechat=nullif(p_data->>'wechat',''),answers=p_data->'answers',updated_at=stamp WHERE id=sub.id;
    INSERT INTO public.activity_registration_audit(submission_id,action) VALUES(sub.id,'updated_by_attendee');
    RETURN jsonb_build_object('ok',true,'status',sub.status,'submissionId',sub.id);
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  CASE p_operation
  WHEN 'review' THEN
    IF new_status IS NULL OR new_status NOT IN ('approved','rejected','waitlisted') THEN RAISE EXCEPTION 'INVALID_REVIEW'; END IF;
    IF new_status<>'approved' THEN
      DELETE FROM public.activity_registration_people WHERE submission_id=sub.id RETURNING * INTO link;
      IF FOUND THEN INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid,detail)
        VALUES(sub.id,'person_unlinked',actor,jsonb_build_object('personId',link.person_id::text)); END IF;
    END IF;
    UPDATE public.activity_registration_submissions SET status=new_status,reviewed_by=actor,reviewed_at=stamp,updated_at=stamp WHERE id=sub.id;
    INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid) VALUES(sub.id,new_status,actor);
    RETURN jsonb_build_object('ok',true,'row',jsonb_build_object('id',sub.id,'status',new_status));
  WHEN 'notify' THEN
    IF sub.status<>'approved' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
    UPDATE public.activity_registration_submissions SET notification_status='sent',updated_at=stamp WHERE id=sub.id;
    INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid) VALUES(sub.id,'notification_marked',actor);
    RETURN jsonb_build_object('ok',true);
  WHEN 'rotate' THEN
    IF sub.management_token_hash<>h OR next_hash IS NULL OR next_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    WITH rotated AS (UPDATE public.activity_registration_submissions SET management_token_hash=next_hash,updated_at=stamp
      WHERE management_token_hash=h RETURNING id)
      INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid) SELECT id,'management_link_reissued',actor FROM rotated;
    SELECT * INTO STRICT pgrow FROM public.activity_registration_pages WHERE id=sub.page_id;
    RETURN jsonb_build_object('slug',pgrow.slug);
  WHEN 'link' THEN
    IF sub.status<>'approved' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
    person_key:=(p_data->>'personId')::bigint;
    PERFORM 1 FROM public.persons WHERE id=person_key AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERSON_NOT_FOUND'; END IF;
    SELECT * INTO STRICT pgrow FROM public.activity_registration_pages WHERE id=sub.page_id FOR SHARE;
    SELECT * INTO link FROM public.activity_registration_people WHERE submission_id=sub.id;
    IF FOUND AND link.person_id=person_key THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
    IF FOUND THEN INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid,detail)
      VALUES(sub.id,'person_unlinked',actor,jsonb_build_object('personId',link.person_id::text)); END IF;
    BEGIN
      INSERT INTO public.activity_registration_people(submission_id,activity_id,person_id,linked_by)
        VALUES(sub.id,pgrow.activity_id,person_key,actor) ON CONFLICT(submission_id) DO UPDATE
        SET person_id=excluded.person_id,linked_by=excluded.linked_by,linked_at=stamp RETURNING * INTO link;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PERSON_ALREADY_LINKED_TO_EVENT'; END;
    INSERT INTO public.activity_registration_audit(submission_id,action,actor_uid,detail)
      VALUES(sub.id,'person_linked',actor,jsonb_build_object('personId',person_key::text));
    RETURN jsonb_build_object('ok',true,'link',to_jsonb(link));
  ELSE RAISE EXCEPTION 'UNKNOWN_ACTION';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.crm_activity_registration_write_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_activity_registration_write_v1(text,jsonb) TO service_role;
COMMIT;
