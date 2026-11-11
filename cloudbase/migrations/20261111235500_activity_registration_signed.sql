BEGIN;
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
COMMIT;
