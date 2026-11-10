-- Emergency rollback restores the previously exposed anon issue path.
-- Revoke anon access separately after restoring compatible device callers.
BEGIN;
SET LOCAL lock_timeout='4s';

CREATE OR REPLACE FUNCTION public.crm_device_delegate_v1(p_op text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; d public.crm_device_delegations%ROWTYPE;
BEGIN
 IF claims IS NULL OR claims->>'role' IS DISTINCT FROM 'anon' OR claims ? 'sub' OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 IF p_args->>'audience' NOT IN ('ai_parse','person_360','recruit_goals','today_coach') OR p_args->>'payload_hash' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 DELETE FROM public.crm_device_delegations WHERE expires_at<=clock_timestamp();
 IF p_op='issue' THEN
  d.actor:=p_args->>'actor'; d.origin:=p_args->>'origin'; d.fingerprint:=p_args->>'fingerprint';
  IF coalesce(length(d.actor),0) NOT BETWEEN 1 AND 120 OR d.origin NOT IN ('browser','mcp','worker') OR (d.origin='browser') IS DISTINCT FROM (d.fingerprint IS NOT NULL) THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 ELSIF p_op='consume' THEN
  DELETE FROM public.crm_device_delegations WHERE token=(p_args->>'token')::uuid AND audience=p_args->>'audience' AND payload_hash=p_args->>'payload_hash' AND expires_at>clock_timestamp() RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 ELSE RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 IF d.origin='browser' AND NOT EXISTS(SELECT FROM public.crm_access_members m JOIN public.crm_browser_devices b ON b.uid=m.uid
   WHERE m.uid=d.actor AND m.enabled AND b.fingerprint=d.fingerprint AND b.state='approved' FOR SHARE OF m,b) THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 IF p_op='issue' THEN INSERT INTO public.crm_device_delegations(actor,fingerprint,origin,audience,payload_hash)
  VALUES(d.actor,d.fingerprint,d.origin,p_args->>'audience',p_args->>'payload_hash') RETURNING token INTO d.token; RETURN jsonb_build_object('token',d.token); END IF;
 RETURN jsonb_build_object('actor',d.actor,'origin',d.origin,'fingerprint',d.fingerprint);
END $fn$;

REVOKE ALL ON FUNCTION public.crm_device_delegate_v1(text,jsonb) FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_device_delegate_v1(text,jsonb) TO anon;

COMMIT;
