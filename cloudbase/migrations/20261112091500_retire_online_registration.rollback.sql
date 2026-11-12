BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.crm_person_role_sync_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ids bigint[] := '{}';
  v_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'persons' THEN
    v_ids := v_ids || NEW.id;
  ELSIF TG_TABLE_NAME = 'activity_participants' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.canonical_person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.canonical_person_id;
    END IF;
  ELSE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
    END IF;
  END IF;

  FOREACH v_id IN ARRAY (
    SELECT array_agg(DISTINCT x) FROM unnest(v_ids) AS x WHERE x IS NOT NULL
  ) LOOP
    PERFORM public.crm_person_roles_derive_v1(v_id);
  END LOOP;
  RETURN NULL;
END
$function$;
-- Restore contracts only. Historic rows intentionally removed by the approved cutover cannot be reconstructed. New signing identities start disabled.

GRANT INSERT,UPDATE,DELETE ON public.activity_participants TO anon;
-- Public activity registration is isolated from CloudBase user identities.
-- CRM clients and the public page access these rows only through the dedicated
-- activity_registration function using its server-only service_role API key.
CREATE TABLE public.activity_registration_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id bigint NOT NULL UNIQUE REFERENCES public.activities(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  form_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(form_schema) = 'array'),
  capacity integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.activity_registration_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.activity_registration_pages(id) ON DELETE RESTRICT,
  attendee_name text NOT NULL CHECK (length(btrim(attendee_name)) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40),
  wechat text CHECK (wechat IS NULL OR length(wechat) BETWEEN 1 AND 100),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  management_token_hash char(64) NOT NULL UNIQUE CHECK (management_token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','waitlisted','withdrawn')),
  notification_status text NOT NULL DEFAULT 'not_sent' CHECK (notification_status IN ('not_sent','sent','failed')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_registration_submissions_page_created_idx
  ON public.activity_registration_submissions(page_id, created_at DESC, id);
CREATE INDEX activity_registration_submissions_review_idx
  ON public.activity_registration_submissions(status, created_at DESC, id);

CREATE TABLE public.activity_registration_people (
  id bigserial PRIMARY KEY,
  submission_id uuid NOT NULL UNIQUE REFERENCES public.activity_registration_submissions(id) ON DELETE RESTRICT,
  activity_id bigint NOT NULL REFERENCES public.activities(id) ON DELETE RESTRICT,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, person_id)
);
CREATE INDEX activity_registration_people_person_idx
  ON public.activity_registration_people(person_id, linked_at DESC, id);
CREATE INDEX activity_registration_people_activity_idx
  ON public.activity_registration_people(activity_id, linked_at DESC, id);

CREATE TABLE public.activity_registration_audit (
  id bigserial PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.activity_registration_submissions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('submitted','updated_by_attendee','approved','rejected','waitlisted','notification_marked','management_link_reissued','person_linked','person_unlinked')),
  actor_uid text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_registration_audit_submission_idx
  ON public.activity_registration_audit(submission_id, created_at DESC, id);

ALTER TABLE public.activity_registration_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_people FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_registration_pages_service_only ON public.activity_registration_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_submissions_service_only ON public.activity_registration_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_people_service_only ON public.activity_registration_people
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_audit_service_only ON public.activity_registration_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.activity_registration_pages,
  public.activity_registration_submissions,
  public.activity_registration_people,
  public.activity_registration_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.activity_registration_pages,
  public.activity_registration_submissions,
  public.activity_registration_people,
  public.activity_registration_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.activity_registration_people_id_seq,
  public.activity_registration_audit_id_seq TO service_role;


SET LOCAL lock_timeout='4s';
DO $$ BEGIN
 IF pg_catalog.pg_get_serial_sequence('public.activity_registration_people','id') IS DISTINCT FROM 'public.activity_registration_people_id_seq'
 OR pg_catalog.pg_get_serial_sequence('public.activity_registration_audit','id') IS DISTINCT FROM 'public.activity_registration_audit_id_seq'
 THEN RAISE EXCEPTION 'Unexpected registration sequence ownership'; END IF;
END $$;
REVOKE SELECT, UPDATE, USAGE ON SEQUENCE public.activity_registration_people_id_seq, public.activity_registration_audit_id_seq FROM anon, authenticated;

SET LOCAL lock_timeout = '4s';

ALTER TABLE public.activity_registration_submissions
  DROP CONSTRAINT activity_registration_submissions_management_token_hash_key;
CREATE INDEX activity_registration_submissions_management_token_hash_idx
  ON public.activity_registration_submissions(management_token_hash, created_at DESC, id);


SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';

-- Fail if another package already owns this extension. Review its ACLs separately.
CREATE EXTENSION pgcrypto WITH SCHEMA public VERSION '1.3';
COMMENT ON EXTENSION pgcrypto IS 'Installed by CRM migration 20261111234500 for activity registration';
DO $migration$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature, n.nspname, p.oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid
    JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid AND d.refclassid='pg_catalog.pg_extension'::regclass
    WHERE e.extname='pgcrypto' AND d.deptype='e'
  LOOP
    IF f.nspname <> 'public' THEN RAISE EXCEPTION 'Unexpected pgcrypto member schema'; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);
    IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
       OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected pgcrypto execution grant';
    END IF;
  END LOOP;
  IF to_regprocedure('public.hmac(bytea,bytea,text)') IS NULL THEN RAISE EXCEPTION 'HMAC missing'; END IF;
END $migration$;

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

SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';

CREATE TABLE public.activity_registration_signers (
  scope text PRIMARY KEY CHECK (scope IN ('public','staff')),
  signing_key bytea NOT NULL CHECK (octet_length(signing_key)=32),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE public.activity_registration_nonces (
  scope text NOT NULL, nonce uuid NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(scope,nonce)
);
CREATE TABLE public.activity_registration_receipts (
  scope text NOT NULL, client text NOT NULL, request_id uuid NOT NULL,
  input_digest bytea NOT NULL, iv bytea NOT NULL, result bytea NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,client,request_id)
);
CREATE INDEX activity_registration_nonces_expiry ON public.activity_registration_nonces(expires_at);
CREATE INDEX activity_registration_receipts_expiry ON public.activity_registration_receipts(expires_at);
ALTER TABLE public.activity_registration_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_signers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_registration_signers,public.activity_registration_nonces,public.activity_registration_receipts FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.activity_registration_signers(scope,signing_key) VALUES
 ('public',public.gen_random_bytes(32)),('staff',public.gen_random_bytes(32));

CREATE FUNCTION public.crm_registration_public_data_v1(op text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE page public.activity_registration_pages%ROWTYPE;
  sub public.activity_registration_submissions%ROWTYPE;
  activity jsonb; token text; h text:=d->>'ownerHash'; field jsonb; answers jsonb:=coalesce(d->'answers','{}'); val text; result jsonb;
BEGIN
  IF op IN ('getPublishedPage','submit') THEN
    SELECT p.* INTO page FROM public.activity_registration_pages p WHERE p.slug=d->>'slug' AND p.status='published';
    SELECT jsonb_build_object('id',a.id,'name',a.name,'activity_date',a.activity_date,'activity_type',a.activity_type,'location',a.location,'description',a.description)
      INTO activity FROM public.activities a WHERE a.id=page.activity_id AND a.deleted_at IS NULL;
    IF activity IS NULL THEN RAISE EXCEPTION 'PAGE_UNAVAILABLE'; END IF;
    IF op='getPublishedPage' THEN RETURN jsonb_build_object('page',jsonb_build_object('slug',page.slug,'content',page.content,'formSchema',page.form_schema,'activity',activity,'capacity',page.capacity)); END IF;
  ELSIF op='getMyRegistration' THEN
    SELECT jsonb_agg(row_data ORDER BY created_at DESC,id DESC) INTO result FROM (
      SELECT s.id,s.created_at,jsonb_build_object('id',s.id,'slug',p.slug,'attendeeName',s.attendee_name,'phone',s.phone,'wechat',s.wechat,
        'answers',s.answers,'status',s.status,'notificationStatus',s.notification_status,'updatedAt',s.updated_at,
        'activityName',a.name,'activity',jsonb_build_object('id',a.id,'name',a.name,'activity_date',a.activity_date,'location',a.location),
        'content',p.content,'formSchema',p.form_schema) row_data FROM public.activity_registration_submissions s
        JOIN public.activity_registration_pages p ON p.id=s.page_id JOIN public.activities a ON a.id=p.activity_id AND a.deleted_at IS NULL
        WHERE s.management_token_hash=h AND s.status<>'withdrawn' ORDER BY s.created_at DESC,s.id DESC LIMIT 50
    ) mine;
    IF result IS NULL THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('registrations',result);
  ELSIF op='updateMyRegistration' THEN
    SELECT s.* INTO sub FROM public.activity_registration_submissions s WHERE s.id=(d->>'submissionId')::uuid AND s.management_token_hash=h AND s.status<>'withdrawn';
    IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
    SELECT p.* INTO STRICT page FROM public.activity_registration_pages p WHERE p.id=sub.page_id;
  ELSE RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF nullif(trim(d->>'attendeeName'),'') IS NULL OR (nullif(d->>'phone','') IS NULL AND nullif(d->>'wechat','') IS NULL) THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF jsonb_typeof(answers)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(answers) k WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(page.form_schema) f WHERE f->>'key'=k)) THEN RAISE EXCEPTION 'FORM_INVALID'; END IF;
  FOR field IN SELECT * FROM jsonb_array_elements(page.form_schema) LOOP
    val:=coalesce(answers->>(field->>'key'),'');
    IF coalesce((field->>'required')::boolean,false) AND trim(val)='' THEN RAISE EXCEPTION 'FORM_REQUIRED'; END IF;
    IF length(val)>1000 OR (val<>'' AND field->>'type'='select' AND NOT (field->'options' ? val)) THEN RAISE EXCEPTION 'FORM_INVALID'; END IF;
  END LOOP;
  IF op='submit' AND h IS NULL THEN
    token:=translate(rtrim(encode(public.gen_random_bytes(32),'base64'),'='),'+/','-_');
    h:=encode(sha256(convert_to(token,'UTF8')),'hex');
  END IF;
  result:=public.crm_activity_registration_write_v1(CASE op WHEN 'submit' THEN 'submit' ELSE 'edit' END,
    jsonb_build_object('id',sub.id,'pageId',page.id,'schema',page.form_schema,'name',d->>'attendeeName','phone',d->>'phone','wechat',d->>'wechat','answers',answers,
      'hash',h,'reuse',d->>'ownerHash' IS NOT NULL));
  IF op='submit' THEN result:=result||jsonb_build_object('ok',true,'status','pending','activityName',activity->>'name','managementToken',token); END IF;
  RETURN result;
END $fn$;

CREATE FUNCTION public.crm_registration_staff_data_v1(op text,d jsonb,actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE result jsonb; item public.activity_registration_pages%ROWTYPE; token text; page_num integer; page_size integer;
BEGIN
  CASE op
  WHEN 'listPages' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC),'[]') INTO result FROM
     (SELECT p.* FROM public.activity_registration_pages p JOIN public.activities a ON a.id=p.activity_id AND a.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 200) x;
    RETURN jsonb_build_object('rows',result);
  WHEN 'savePage' THEN
    PERFORM 1 FROM public.activities WHERE id=(d->>'activityId')::bigint AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVITY_NOT_FOUND'; END IF;
    IF d->>'id' IS NULL THEN
      INSERT INTO public.activity_registration_pages(activity_id,slug,status,content,form_schema,published_at)
       VALUES((d->>'activityId')::bigint,d->>'slug',d->>'status',d->'content',d->'formSchema',CASE WHEN d->>'status'='published' THEN now() END) RETURNING * INTO item;
    ELSE
      UPDATE public.activity_registration_pages SET slug=d->>'slug',status=d->>'status',content=d->'content',form_schema=d->'formSchema',
        updated_at=now(),published_at=CASE WHEN d->>'status'='published' THEN coalesce(published_at,now()) END
       WHERE id=(d->>'id')::uuid AND activity_id=(d->>'activityId')::bigint RETURNING * INTO item;
      IF NOT FOUND THEN RAISE EXCEPTION 'PAGE_NOT_FOUND'; END IF;
    END IF;
    RETURN jsonb_build_object('page',to_jsonb(item),'slug',item.slug);
  WHEN 'listSubmissions' THEN
    page_num:=greatest(1,least(10000,coalesce((d->>'page')::int,1)));page_size:=greatest(1,least(50,coalesce((d->>'pageSize')::int,20)));
    SELECT coalesce(jsonb_agg(to_jsonb(x)-'management_token_hash' ORDER BY x.created_at DESC,x.id DESC),'[]') INTO result FROM
      (SELECT s.* FROM public.activity_registration_submissions s WHERE s.page_id=(d->>'pageId')::uuid AND (coalesce(d->>'status','')='' OR s.status=d->>'status')
       ORDER BY s.created_at DESC,s.id DESC LIMIT page_size+1 OFFSET ((page_num-1)*page_size)) x;
    RETURN jsonb_build_object('rows',CASE WHEN jsonb_array_length(result)>page_size THEN result-page_size ELSE result END,'hasMore',jsonb_array_length(result)>page_size,'page',page_num,'pageSize',page_size);
  WHEN 'review','markNotified','linkPerson','reissueManagementLink' THEN
    IF op='reissueManagementLink' THEN token:=translate(rtrim(encode(public.gen_random_bytes(32),'base64'),'='),'+/','-_'); END IF;
    result:=public.crm_activity_registration_write_v1(CASE op WHEN 'review' THEN 'review' WHEN 'markNotified' THEN 'notify' WHEN 'linkPerson' THEN 'link' ELSE 'rotate' END,
      jsonb_build_object('id',coalesce(d->>'submissionId',d->>'id'),'actor',actor,'status',d->>'status','personId',d->>'personId','newHash',encode(sha256(convert_to(token,'UTF8')),'hex')));
    IF token IS NOT NULL THEN result:=result||jsonb_build_object('managementToken',token); END IF;
    RETURN result;
  WHEN 'searchPersons' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.display_name,x.id),'[]') INTO result FROM
      (SELECT id,display_name FROM public.persons WHERE deleted_at IS NULL AND length(trim(d->>'keyword')) BETWEEN 1 AND 80 AND strpos(lower(display_name),lower(trim(d->>'keyword')))>0 ORDER BY display_name,id LIMIT 15) x;
  WHEN 'personActivities' THEN
    SELECT coalesce(jsonb_agg(x.item ORDER BY x.linked_at DESC),'[]') INTO result FROM
      (SELECT l.linked_at,jsonb_build_object('id',s.id,'page_id',s.page_id,'status',s.status,'created_at',s.created_at,
       'title',coalesce(nullif(p.content->>'title',''),a.name),'activity',jsonb_build_object('id',a.id,'name',a.name,'activity_date',a.activity_date,'location',a.location)) item
       FROM public.activity_registration_people l JOIN public.activity_registration_submissions s ON s.id=l.submission_id AND s.status='approved'
       JOIN public.activity_registration_pages p ON p.id=s.page_id JOIN public.activities a ON a.id=l.activity_id AND a.deleted_at IS NULL
       WHERE l.person_id=(d->>'personId')::bigint ORDER BY l.linked_at DESC LIMIT 100) x;
  WHEN 'activityPeople' THEN
    SELECT coalesce(jsonb_agg(x.item ORDER BY x.linked_at DESC),'[]') INTO result FROM
      (SELECT l.linked_at,jsonb_build_object('personId',p.id::text,'personName',p.display_name,'attendeeName',s.attendee_name,'status',s.status,'linkedAt',l.linked_at) item
       FROM public.activity_registration_people l JOIN public.persons p ON p.id=l.person_id AND p.deleted_at IS NULL
       JOIN public.activity_registration_submissions s ON s.id=l.submission_id AND s.status='approved'
       JOIN public.activities a ON a.id=l.activity_id AND a.deleted_at IS NULL WHERE l.activity_id=(d->>'activityId')::bigint ORDER BY l.linked_at DESC LIMIT 100) x;
  ELSE RAISE EXCEPTION 'ACCESS_DENIED';
  END CASE;
  RETURN jsonb_build_object('rows',result);
END $fn$;

CREATE FUNCTION public.crm_registration_handle_v1(expected_scope text,p_envelope text,p_mac text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE cfg public.activity_registration_signers%ROWTYPE; env jsonb; message jsonb; result jsonb;
  n uuid; issued bigint; now_at timestamptz:=clock_timestamp(); op text; actor text; client text;
  rid uuid; signature bytea; enc_key bytea; cache_key bytea; digest_in bytea; iv bytea; ciphertext bytea;
  receipt public.activity_registration_receipts%ROWTYPE; write_op boolean;
BEGIN
  IF expected_scope NOT IN ('staff','public') OR p_envelope IS NULL OR octet_length(p_envelope)>215000 OR p_mac IS NULL OR p_mac !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT * INTO cfg FROM public.activity_registration_signers WHERE scope=expected_scope AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  signature:=public.hmac(convert_to(p_envelope,'UTF8'),public.hmac(convert_to('request-mac','UTF8'),cfg.signing_key,'sha256'),'sha256');
  IF signature IS DISTINCT FROM decode(p_mac,'hex') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  env:=p_envelope::jsonb;
  IF env->>'scope' IS DISTINCT FROM expected_scope OR env->>'v' IS DISTINCT FROM '1' OR env->>'aud' IS DISTINCT FROM 'crm-d1gkae8ddc930d151' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  n:=(env->>'nonce')::uuid; issued:=(env->>'issued')::bigint;
  IF n IS NULL OR issued IS NULL OR abs(extract(epoch FROM now_at)-issued)>30 THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  DELETE FROM public.activity_registration_nonces WHERE expires_at<now_at;
  INSERT INTO public.activity_registration_nonces VALUES(expected_scope,n,now_at+interval '90 seconds') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF_USED'; END IF;
  enc_key:=public.hmac(convert_to('request-enc','UTF8'),cfg.signing_key,'sha256');
  message:=convert_from(public.decrypt_iv(decode(env->>'ciphertext','hex'),enc_key,decode(env->>'iv','hex'),'aes-cbc/pad:pkcs'),'UTF8')::jsonb;
  op:=message->>'action'; actor:=message->>'actor'; rid:=(message->>'requestId')::uuid;
  client:=message->>'client';
  BEGIN
    IF expected_scope='staff' AND NOT EXISTS(SELECT 1 FROM public.crm_access_members m JOIN public.crm_browser_devices b ON b.uid=m.uid
      WHERE m.uid=actor AND m.enabled AND b.state='approved' AND b.fingerprint=message->>'fingerprint') THEN RAISE EXCEPTION 'STAFF_ACCESS_DENIED'; END IF;
    write_op:=op IN ('submit','updateMyRegistration','savePage','review','markNotified','linkPerson','reissueManagementLink');
    IF write_op THEN
      IF client IS NULL OR client !~ '^[a-f0-9]{64}$' OR rid IS NULL THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
      DELETE FROM public.activity_registration_receipts WHERE expires_at<now_at;
      PERFORM pg_advisory_xact_lock(hashtextextended(expected_scope||client||rid::text,0));
      cache_key:=public.hmac(convert_to('receipt-enc','UTF8'),cfg.signing_key,'sha256');
      digest_in:=sha256(convert_to(message::text,'UTF8'));
      SELECT r.* INTO receipt FROM public.activity_registration_receipts r
       WHERE r.scope=expected_scope AND r.client=message->>'client' AND r.request_id=rid;
      IF FOUND THEN
        IF receipt.input_digest IS DISTINCT FROM digest_in THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
        result:=convert_from(public.decrypt_iv(receipt.result,cache_key,receipt.iv,'aes-cbc/pad:pkcs'),'UTF8')::jsonb;
      END IF;
    END IF;
    IF result IS NULL THEN
      IF expected_scope='public' THEN result:=public.crm_registration_public_data_v1(op,message->'data');
      ELSE result:=public.crm_registration_staff_data_v1(op,message->'data',actor); END IF;
      IF write_op THEN
        iv:=public.gen_random_bytes(16);
        INSERT INTO public.activity_registration_receipts VALUES(expected_scope,client,rid,digest_in,iv,
          public.encrypt_iv(convert_to(result::text,'UTF8'),cache_key,iv,'aes-cbc/pad:pkcs'),now_at+interval '24 hours');
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN result:=jsonb_build_object('error','DUPLICATE_PAGE');
    WHEN raise_exception THEN result:=jsonb_build_object('error',CASE WHEN SQLERRM ~ '^[A-Z_]{3,60}$' THEN SQLERRM ELSE 'REGISTRATION_DATABASE_UNAVAILABLE' END);
    WHEN data_exception OR integrity_constraint_violation THEN result:=jsonb_build_object('error','FORM_INVALID');
  END;
  iv:=public.gen_random_bytes(16);
  ciphertext:=public.encrypt_iv(convert_to(result::text,'UTF8'),public.hmac(convert_to('response-enc','UTF8'),cfg.signing_key,'sha256'),iv,'aes-cbc/pad:pkcs');
  signature:=public.hmac(convert_to(expected_scope||'.'||n::text||'.'||encode(iv,'hex')||'.'||encode(ciphertext,'hex'),'UTF8'),
    public.hmac(convert_to('response-mac','UTF8'),cfg.signing_key,'sha256'),'sha256');
  RETURN jsonb_build_object('iv',encode(iv,'hex'),'ciphertext',encode(ciphertext,'hex'),'mac',encode(signature,'hex'));
END $fn$;

CREATE FUNCTION public.crm_registration_public_v1(p_envelope text,p_mac text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT public.crm_registration_handle_v1('public',p_envelope,p_mac)$$;
CREATE FUNCTION public.crm_registration_staff_v1(p_envelope text,p_mac text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT public.crm_registration_handle_v1('staff',p_envelope,p_mac)$$;
REVOKE ALL ON FUNCTION public.crm_registration_public_data_v1(text,jsonb),public.crm_registration_staff_data_v1(text,jsonb,text),
 public.crm_registration_handle_v1(text,text,text),public.crm_registration_public_v1(text,text),public.crm_registration_staff_v1(text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_registration_public_v1(text,text),public.crm_registration_staff_v1(text,text) TO anon;

SET LOCAL lock_timeout='5s';
CREATE TABLE public.activity_participant_responses (
  participant_id bigint PRIMARY KEY REFERENCES public.activity_participants(id) ON DELETE CASCADE,
  response text NOT NULL CHECK (response IN ('registered','cancelled','unrecorded')),
  version uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE public.activity_participant_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_participant_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY participant_response_service ON public.activity_participant_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.activity_participant_responses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.activity_participant_responses TO service_role;

CREATE FUNCTION public.crm_event_participation_v1(p_actor_uid text,p_op text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE
  event_id bigint := (p_input->>'activityId')::bigint;
  person_key bigint := (p_input->>'personId')::bigint;
  part_key bigint := (p_input->>'participantId')::bigint;
  page_no integer := coalesce((p_input->>'page')::integer,1);
  r public.activity_participants%ROWTYPE;
  previous uuid;
  new_response text := p_input->>'response';
  new_status text := p_input->>'status';
  result jsonb;
BEGIN
  IF current_user <> 'service_role' OR coalesce(length(btrim(p_actor_uid)),0) NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid participation request'; END IF;

  IF p_op='person' THEN
    IF p_input-ARRAY['personId','page'] <> '{}'::jsonb OR person_key IS NULL OR person_key < 1 OR page_no NOT BETWEEN 1 AND 100000
       THEN RAISE EXCEPTION 'Invalid participation page'; END IF;
    PERFORM 1 FROM public.persons WHERE id=person_key AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person unavailable'; END IF;
    WITH events AS MATERIALIZED (
      SELECT DISTINCT ON (a.id) a.id AS activity_id,a.name,a.activity_date,ap.status,ap.participant_role,
        coalesce(s.response,'unrecorded') AS response,work.id AS action_id,work.title AS action_title,work.status AS action_status
      FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id AND a.deleted_at IS NULL
      LEFT JOIN public.activity_participant_responses s ON s.participant_id=ap.id
      LEFT JOIN public.v_next_context_action work ON work.kind='activity' AND work.target_id=a.id AND work.person_id=person_key
      WHERE ap.canonical_person_id=person_key AND ap.deleted_at IS NULL
      ORDER BY a.id,ap.updated_at DESC NULLS LAST,ap.id DESC
    ), page_rows AS (
      SELECT * FROM events ORDER BY activity_date DESC NULLS LAST,activity_id DESC LIMIT 20 OFFSET (page_no-1)*20
    )
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY activity_date DESC NULLS LAST,activity_id DESC) FROM page_rows e),'[]'::jsonb),
      'total',count(*),'attended',count(*) FILTER(WHERE status='attended'),'hasMore',count(*)>page_no*20) INTO result FROM events;
    RETURN result;
  END IF;

  IF event_id IS NULL OR event_id<1 THEN RAISE EXCEPTION 'Invalid activity'; END IF;
  IF p_op='responses' AND p_input-'activityId'='{}'::jsonb THEN
    SELECT coalesce(jsonb_object_agg(ap.id,jsonb_build_object('response',s.response,'version',s.version)),'{}'::jsonb)
      INTO result FROM public.activity_participant_responses s
      JOIN public.activity_participants ap ON ap.id=s.participant_id AND ap.deleted_at IS NULL
      JOIN public.activities a ON a.id=ap.activity_id AND a.deleted_at IS NULL WHERE a.id=event_id;
    RETURN jsonb_build_object('responses',result);
  END IF;
  IF p_op IS DISTINCT FROM 'save' OR p_input-ARRAY['participantId','activityId','version','updatedAt','expectedStatus','response','status'] <> '{}'::jsonb
    OR NOT (p_input ?& ARRAY['participantId','activityId','version','updatedAt','expectedStatus','response','status'])
    OR part_key IS NULL OR part_key<1 OR coalesce(new_response,'') NOT IN ('registered','cancelled','unrecorded')
    OR coalesce(new_status,'') NOT IN ('invited','attended','absent') THEN RAISE EXCEPTION 'Invalid participation change'; END IF;

  PERFORM 1 FROM public.activities WHERE id=event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Activity unavailable'; END IF;
  SELECT * INTO STRICT r FROM public.activity_participants WHERE id=part_key AND activity_id=event_id AND deleted_at IS NULL FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
    AND NOT EXISTS (SELECT 1 FROM public.crm_test_batches b JOIN public.crm_test_records er ON er.batch_key=b.batch_key
      JOIN public.crm_test_records ar ON ar.batch_key=b.batch_key
      WHERE b.created_by_uid=p_actor_uid AND er.record_table='activities' AND er.record_id=event_id::text
        AND ar.record_table='activity_participants' AND ar.record_id=part_key::text)
    THEN RAISE EXCEPTION 'Test account requires tracked participants'; END IF;
  SELECT version INTO previous FROM public.activity_participant_responses WHERE participant_id=part_key;
  IF previous IS DISTINCT FROM (p_input->>'version')::uuid OR r.updated_at IS DISTINCT FROM (p_input->>'updatedAt')::timestamptz
    OR r.status IS DISTINCT FROM (p_input->>'expectedStatus') THEN RAISE EXCEPTION 'Participation changed'; END IF;
  IF previous IS NOT NULL OR new_response <> 'unrecorded' THEN
    INSERT INTO public.activity_participant_responses(participant_id,response) VALUES(part_key,new_response)
      ON CONFLICT(participant_id) DO UPDATE SET response=excluded.response,version=excluded.version;
  END IF;
  UPDATE public.activity_participants SET status=new_status,updated_at=clock_timestamp() WHERE id=part_key;
  RETURN jsonb_build_object('ok',true);
END
$fn$;
REVOKE ALL ON FUNCTION public.crm_event_participation_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_event_participation_v1(text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.crm_business_report_v1(p_actor_uid text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  mode text:=p_input->>'mode'; queue_name text:=p_input->>'queue';
  days integer:=coalesce((p_input->>'days')::integer,30); page_no integer:=coalesce((p_input->>'page')::integer,1);
  today date:=(now() AT TIME ZONE 'Asia/Shanghai')::date; start_day date; start_at timestamptz; end_at timestamptz;
  key text; counts jsonb; result jsonb;
BEGIN
  IF current_user<>'service_role' OR coalesce(length(btrim(p_actor_uid)),0) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(mode,'') NOT IN ('home','list','report')
    OR days NOT IN (7,30,90) OR page_no NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid business report'; END IF;
  IF mode='list' THEN
    IF coalesce(queue_name,'') NOT IN ('protection','recruitment','event') THEN RAISE EXCEPTION 'Invalid follow-up list'; END IF;
    WITH matching AS MATERIALIZED (SELECT * FROM public.v_business_followup_queue q WHERE q.queue=queue_name),
    visible AS (SELECT * FROM matching ORDER BY day,id,person_id NULLS LAST,unresolved_id LIMIT 20 OFFSET (page_no-1)*20)
    SELECT jsonb_build_object('asOf',today,'page',page_no,'total',count(*),'hasMore',count(*)>page_no*20,
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY day,id,person_id NULLS LAST,unresolved_id) FROM visible v),'[]'::jsonb))
      INTO result FROM matching;
    RETURN result;
  END IF;
  SELECT jsonb_build_object('protection',count(*) FILTER(WHERE queue='protection'),'recruitment',count(*) FILTER(WHERE queue='recruitment'),
    'event',count(*) FILTER(WHERE queue='event')) INTO counts FROM public.v_business_followup_queue;
  FOREACH key IN ARRAY ARRAY['today','overdue','waiting'] LOOP
    counts:=counts||jsonb_build_object(key,public.crm_action_center_v1(p_actor_uid,jsonb_build_object('view',key))->'total');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['review','renewal','verify'] LOOP
    counts:=counts||jsonb_build_object(key,public.person_customer_worklist_v1(jsonb_build_object('page',1,'pageSize',1,'keyword','','sortField','id',
      'sortDir','asc','status','all','customerPriorities','[]'::jsonb,'policyFilter',key))->'total');
  END LOOP;
  IF mode='home' THEN RETURN jsonb_build_object('asOf',today,'counts',counts); END IF;
  start_day:=today-days+1; start_at:=start_day::timestamp AT TIME ZONE 'Asia/Shanghai'; end_at:=(today+1)::timestamp AT TIME ZONE 'Asia/Shanghai';
  WITH live_people AS MATERIALIZED (SELECT id FROM public.persons WHERE deleted_at IS NULL),
  clients AS MATERIALIZED (SELECT c."Id" AS id,c.person_id FROM public.customers c JOIN live_people p ON p.id=c.person_id WHERE c.deleted_at IS NULL),
  pipeline AS MATERIALIZED (
    SELECT b.* FROM public.v_business_pipeline_records b WHERE b.track IN ('protection','recruitment') AND
      (b.customer_id IS NULL OR EXISTS(SELECT 1 FROM clients c WHERE c.id=b.customer_id AND c.person_id=b.person_id))
  ), moves AS MATERIALIZED (
    SELECT b.track,b.id AS record_id,d.id,d.prior_id,d.confirmed_at,d.stage,d.reason,d.preview->>'before' AS before_stage
    FROM public.crm_pipeline_decisions d JOIN pipeline b ON b.person_id=d.person_id AND
      ((b.track='protection' AND d.protection_id=b.id) OR (b.track='recruitment' AND d.recruit_id=b.id))
    WHERE d.confirmed_at IS NOT NULL AND d.confirmed_at<end_at
  ), period_moves AS (
    SELECT * FROM moves WHERE confirmed_at>=start_at AND before_stage IS NOT NULL AND before_stage<>stage
  ), cohorts AS (
    SELECT track,record_id,min(confirmed_at) AS entered FROM moves
    WHERE stage=CASE track WHEN 'protection' THEN '需求线索' ELSE '关系建立' END AND before_stage IS NOT NULL AND before_stage<>stage
    GROUP BY track,record_id HAVING min(confirmed_at)>=start_at
  ), measured_dwell AS (
    SELECT m.track,(extract(epoch FROM m.confirmed_at-p.confirmed_at)/86400)::numeric AS days_in_stage
    FROM period_moves m JOIN moves p ON p.id=m.prior_id AND p.track=m.track AND p.record_id=m.record_id
      AND p.stage=m.before_stage AND p.before_stage IS NOT NULL AND p.before_stage<>p.stage AND m.confirmed_at>=p.confirmed_at
  ), tracks AS (
    SELECT k AS track,jsonb_build_object(
      'total',(SELECT count(*) FROM pipeline WHERE track=k),
      'active',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed),
      'stages',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',stage,'n',n) ORDER BY stage) FROM
        (SELECT stage,count(*) n FROM pipeline WHERE track=k GROUP BY stage) s),'[]'::jsonb),
      'referral',(SELECT count(*) FROM pipeline WHERE track=k AND declared_source='referral'),
      'unknownSource',(SELECT count(*) FROM pipeline WHERE track=k AND nullif(declared_source,'') IS NULL),
      'moves',(SELECT count(*) FROM period_moves WHERE track=k),
      'movedRecords',(SELECT count(DISTINCT record_id) FROM period_moves WHERE track=k),
      'dueDated',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed AND next_date IS NOT NULL),
      'overdue',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed AND next_date<today),
      'cohort',(SELECT count(*) FROM cohorts WHERE track=k),
      'unverifiedCohort',(SELECT count(*) FROM cohorts c JOIN pipeline b ON b.track=c.track AND b.id=c.record_id
        WHERE c.track=k AND (b.stage IS DISTINCT FROM (SELECT m.stage FROM moves m WHERE m.track=k AND m.record_id=c.record_id ORDER BY m.confirmed_at DESC,m.id DESC LIMIT 1)
        OR EXISTS(SELECT 1 FROM moves m LEFT JOIN moves prev ON prev.id=m.prior_id AND prev.track=m.track AND prev.record_id=m.record_id
          WHERE m.track=k AND m.record_id=c.record_id AND m.confirmed_at>c.entered AND m.before_stage IS DISTINCT FROM prev.stage))),
      'converted',(SELECT count(*) FROM cohorts c WHERE track=k AND EXISTS(SELECT 1 FROM period_moves m WHERE m.track=k AND m.record_id=c.record_id
        AND m.confirmed_at>c.entered AND m.stage=CASE k WHEN 'protection' THEN '已成交' ELSE '已加入' END)),
      'dwellN',(SELECT count(*) FROM measured_dwell WHERE track=k),
      'dwellDays',(SELECT round((percentile_cont(0.5) WITHIN GROUP(ORDER BY days_in_stage))::numeric,1) FROM measured_dwell WHERE track=k),
      'outcomes',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',stage,'n',n) ORDER BY stage) FROM
        (SELECT stage,count(*) n FROM period_moves WHERE track=k AND stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进') GROUP BY stage) s),'[]'::jsonb),
      'recentReasons',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.at DESC,s.id DESC) FROM
        (SELECT id,stage,reason,confirmed_at AS at FROM period_moves WHERE track=k AND stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进')
         AND nullif(btrim(reason),'') IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 5) s),'[]'::jsonb)
    ) AS stats FROM unnest(ARRAY['protection','recruitment']) k
  ), attendance AS MATERIALIZED (
    SELECT ap.*,e.activity_date FROM public.activity_participants ap JOIN public.activities e ON e.id=ap.activity_id AND e.deleted_at IS NULL
    WHERE ap.deleted_at IS NULL AND (ap.canonical_person_id IS NULL OR EXISTS(SELECT 1 FROM live_people p WHERE p.id=ap.canonical_person_id))
  ), roles AS (
    SELECT DISTINCT r.person_id,r.role FROM public.person_roles r JOIN live_people p ON p.id=r.person_id
    WHERE r.role IN ('customer','recruit','referrer','speaker')
    UNION SELECT canonical_person_id,'participant' FROM attendance WHERE canonical_person_id IS NOT NULL
  ), work AS MATERIALIZED (
    SELECT a.* FROM public.actions a JOIN live_people p ON p.id=a.person_id
  ), linked AS MATERIALIZED (
    SELECT DISTINCT l.action_id,l.kind FROM public.v_action_context_links l JOIN work a ON l.action_id=a.id AND l.person_id=a.person_id WHERE
      (l.kind='activity' AND EXISTS(SELECT 1 FROM public.activities e WHERE e.id=l.target_id AND e.deleted_at IS NULL))
      OR EXISTS(SELECT 1 FROM pipeline b WHERE b.id=l.target_id AND b.entity=l.kind AND b.person_id=l.person_id)
      OR (l.kind='opportunity' AND EXISTS(SELECT 1 FROM public.opportunities o WHERE o.id=l.target_id AND o.deleted_at IS NULL AND
        (o.customer_id IS NULL OR EXISTS(SELECT 1 FROM clients c WHERE c.id=o.customer_id AND c.person_id=l.person_id)) AND (o.person_id IS NULL OR o.person_id=l.person_id)))
    UNION SELECT id,'policy' FROM public.v_policy_service_actions
    UNION SELECT a.id,'interaction' FROM work a JOIN public.interactions i ON i.id=a.interaction_id AND i.person_id=a.person_id AND i.deleted_at IS NULL
  ), period_work AS (SELECT * FROM work WHERE due_at>=start_at AND due_at<end_at AND status<>'cancelled'),
  marks AS (SELECT m.to_stage,count(*) n FROM public.recruit_milestones m JOIN pipeline b ON b.track='recruitment' AND b.id=m.candidate_id
    WHERE m.happened_at>=start_at AND m.happened_at<end_at AND m.to_stage IN ('新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司') GROUP BY m.to_stage),
  event_period AS (SELECT a.status,r.response FROM attendance a LEFT JOIN public.activity_participant_responses r ON r.participant_id=a.id
    WHERE a.activity_date BETWEEN start_day AND today),
  review_accepts AS (SELECT cmd.operation FROM public.crm_activity_review_commands cmd JOIN live_people p ON p.id=cmd.person_id
    JOIN public.activities e ON e.id=cmd.activity_id AND e.deleted_at IS NULL WHERE cmd.executed_at>=start_at AND cmd.executed_at<end_at
    AND cmd.operation IN ('action','opportunity') AND cmd.result_json->>'status'='accepted'),
  product_data AS MATERIALIZED (
    SELECT p.customer_id,p.current_policy_description,
      CASE WHEN pg_catalog.pg_input_is_valid(p.items,'jsonb') THEN p.items::jsonb END AS items
    FROM public.products p JOIN clients c ON c.id=p.customer_id WHERE p.deleted_at IS NULL
  ), item_fields AS (
    SELECT f.filled FROM product_data p CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.items)='array' THEN p.items ELSE '[]'::jsonb END) i
    CROSS JOIN LATERAL (SELECT count(*) AS filled FROM unnest(ARRAY['coverage_amount','total_premium','paid_premium','annual_premium','update_date']) k
      WHERE nullif(btrim(i->>k),'') IS NOT NULL) f WHERE f.filled>0
  ), report_state AS MATERIALIZED (SELECT * FROM public.v_policy_review_state)
  SELECT jsonb_build_object('asOf',today,'startDay',start_day,'days',days,'counts',counts,
    'pipeline',(SELECT jsonb_object_agg(track,stats) FROM tracks),
    'milestones',coalesce((SELECT jsonb_object_agg(to_stage,n) FROM marks),'{}'::jsonb),
    'roles',jsonb_build_object('total',(SELECT count(*) FROM live_people),'multi',(SELECT count(*) FROM (SELECT person_id FROM roles GROUP BY person_id HAVING count(*)>1) m),
      'coverage',(SELECT coalesce(jsonb_object_agg(role,n),'{}'::jsonb) FROM (SELECT role,count(*) AS n FROM roles GROUP BY role) rc)),
    'events',jsonb_build_object('heldDates',(SELECT count(*) FROM public.activities WHERE deleted_at IS NULL AND activity_date BETWEEN start_day AND today),
      'entries',(SELECT count(*) FROM event_period),'registered',(SELECT count(*) FROM event_period WHERE response='registered'),
      'cancelled',(SELECT count(*) FROM event_period WHERE response='cancelled'),'attended',(SELECT count(*) FROM event_period WHERE status='attended'),
      'interactions',(SELECT count(*) FROM public.interactions i JOIN live_people p ON p.id=i.person_id JOIN public.activities e ON e.id=i.activity_id AND e.deleted_at IS NULL
        WHERE i.deleted_at IS NULL AND i.interaction_type='post_event_followup' AND i.interaction_at>=start_at AND i.interaction_at<end_at),
      'completed',(SELECT count(*) FROM work a WHERE a.completed_at>=start_at AND a.completed_at<end_at AND a.status='completed' AND EXISTS(SELECT 1 FROM linked l WHERE l.action_id=a.id AND l.kind='activity')),
      'acceptedCandidates',(SELECT count(*) FROM review_accepts WHERE operation='opportunity'),'acceptedActions',(SELECT count(*) FROM review_accepts WHERE operation='action')),
    'actions',jsonb_build_object('open',(SELECT count(*) FROM work WHERE status IN ('open','in_progress')),'dated',(SELECT count(*) FROM work WHERE status IN ('open','in_progress') AND due_at IS NOT NULL),
      'due',(SELECT count(*) FROM period_work),'completed',(SELECT count(*) FROM period_work WHERE status='completed'),
      'unlinked',(SELECT count(*) FROM work a WHERE status IN ('open','in_progress') AND NOT EXISTS(SELECT 1 FROM linked l WHERE l.action_id=a.id)),
      'workload',(SELECT coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) FROM (SELECT l.kind,count(*) n FROM linked l JOIN period_work a ON l.action_id=a.id GROUP BY l.kind) w)),
    'policy',jsonb_build_object('customers',(SELECT count(*) FROM clients),'withProduct',(SELECT count(*) FROM product_data),'described',(SELECT count(*) FROM product_data WHERE nullif(btrim(current_policy_description),'') IS NOT NULL),
      'startedItems',(SELECT count(*) FROM item_fields),'completeItems',(SELECT count(*) FROM item_fields WHERE filled=5),
      'withCurrent',(SELECT count(DISTINCT customer_id) FROM report_state WHERE is_current),'valid',(SELECT count(*) FROM report_state WHERE is_valid),'current',(SELECT count(*) FROM report_state WHERE is_current)))
    INTO result;
  RETURN result;
END
$function$;

COMMIT;
