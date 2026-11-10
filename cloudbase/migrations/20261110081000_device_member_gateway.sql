-- Private service credential, runtime-derived UID only. No approval action or table write grant.
BEGIN;
SET LOCAL lock_timeout='4s';
CREATE FUNCTION public.crm_device_member_gateway_v1(p_op text,p_uid text,p_fingerprint text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 dev public.crm_browser_devices%ROWTYPE; challenge public.crm_device_challenges%ROWTYPE; ttl timestamptz;
BEGIN
 IF claims IS NULL OR claims->>'role' IS DISTINCT FROM 'service_role' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_uid IS NULL OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 -- Serializing enrollment for this individual member prevents concurrent cap bypass.
 IF NOT EXISTS(SELECT 1 FROM public.crm_access_members WHERE uid=p_uid AND enabled FOR UPDATE) THEN RAISE EXCEPTION 'DEVICE_MEMBER_REQUIRED'; END IF;
 SELECT * INTO dev FROM public.crm_browser_devices WHERE uid=p_uid AND fingerprint=p_fingerprint FOR UPDATE;
 IF p_op='request' THEN
  IF p_args->'public_key' IS NULL OR octet_length((p_args->'public_key')::text)>512 OR p_args->>'label' IS NULL OR length(p_args->>'label')>80 THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
  IF dev.uid IS NULL THEN
   IF (SELECT count(*) FROM public.crm_browser_devices WHERE uid=p_uid AND state='pending')>=8 THEN RAISE EXCEPTION 'DEVICE_REQUEST_LIMIT'; END IF;
   INSERT INTO public.crm_browser_devices(uid,fingerprint,public_key,label) VALUES(p_uid,p_fingerprint,p_args->'public_key',p_args->>'label') RETURNING * INTO dev;
  ELSIF dev.public_key IS DISTINCT FROM p_args->'public_key' THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
  RETURN jsonb_build_object('state',dev.state);
 END IF;
 IF dev.state IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'DEVICE_NOT_APPROVED'; END IF;
 DELETE FROM public.crm_device_challenges WHERE expires_at<=clock_timestamp();
 IF p_op='issue' THEN
  IF (SELECT count(*) FROM public.crm_device_challenges WHERE uid=p_uid AND fingerprint=p_fingerprint)>=64 THEN RAISE EXCEPTION 'DEVICE_REQUEST_LIMIT'; END IF;
  INSERT INTO public.crm_device_challenges(uid,fingerprint,audience,payload_hash) VALUES(p_uid,p_fingerprint,p_args->>'audience',p_args->>'payload_hash') RETURNING * INTO challenge;
  RETURN jsonb_build_object('challenge',challenge.id);
 ELSIF p_op IN ('inspect','consume') THEN
  SELECT * INTO challenge FROM public.crm_device_challenges WHERE id=(p_args->>'challenge')::uuid AND uid=p_uid AND fingerprint=p_fingerprint AND audience=p_args->>'audience' AND payload_hash=p_args->>'payload_hash' AND expires_at>clock_timestamp() FOR UPDATE;
  IF challenge.id IS NULL THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
  IF p_op='consume' THEN DELETE FROM public.crm_device_challenges WHERE id=challenge.id; RETURN jsonb_build_object('ok',true); END IF;
  RETURN jsonb_build_object('public_key',dev.public_key);
 END IF;
 RAISE EXCEPTION 'DEVICE_ACCESS_DENIED';
END $fn$;
REVOKE ALL ON FUNCTION public.crm_device_member_gateway_v1(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_device_member_gateway_v1(text,text,text,jsonb) TO service_role;
COMMIT;
