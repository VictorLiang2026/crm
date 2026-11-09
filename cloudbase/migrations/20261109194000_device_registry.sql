-- Preparation only: no user or device is trusted by this migration.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.crm_access_members (
 uid text PRIMARY KEY CHECK(length(uid) BETWEEN 1 AND 120), enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE public.crm_browser_devices (
 uid text NOT NULL REFERENCES public.crm_access_members(uid), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 public_key jsonb NOT NULL CHECK(jsonb_typeof(public_key)='object'), label text NOT NULL CHECK(length(label)<=80),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','revoked')),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(uid,fingerprint)
);
CREATE TABLE public.crm_device_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uid text NOT NULL, fingerprint text NOT NULL,
 audience text NOT NULL CHECK(length(audience) BETWEEN 1 AND 80), payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '90 seconds'),
 FOREIGN KEY(uid,fingerprint) REFERENCES public.crm_browser_devices(uid,fingerprint)
);
ALTER TABLE public.crm_access_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_browser_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_device_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_access_members,public.crm_browser_devices,public.crm_device_challenges FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.crm_access_members,public.crm_browser_devices,public.crm_device_challenges TO service_role;
CREATE POLICY crm_members_service_read ON public.crm_access_members FOR SELECT TO service_role USING(true);
CREATE POLICY crm_devices_service_read ON public.crm_browser_devices FOR SELECT TO service_role USING(true);
CREATE POLICY crm_challenges_service_read ON public.crm_device_challenges FOR SELECT TO service_role USING(true);
CREATE INDEX crm_device_challenges_expiry_idx ON public.crm_device_challenges(expires_at);
CREATE FUNCTION public.crm_device_state_changed_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF OLD.uid IS DISTINCT FROM NEW.uid OR OLD.fingerprint IS DISTINCT FROM NEW.fingerprint OR OLD.public_key IS DISTINCT FROM NEW.public_key
 OR (OLD.state='revoked' AND NEW.state<>'revoked') THEN RAISE EXCEPTION 'Device identity and revocation are immutable'; END IF;
 IF NEW.state='approved' AND NOT EXISTS(SELECT 1 FROM public.crm_access_members WHERE uid=NEW.uid AND enabled FOR UPDATE) THEN RAISE EXCEPTION 'Member is disabled'; END IF;
 IF OLD.state<>NEW.state THEN DELETE FROM public.crm_device_challenges WHERE uid=OLD.uid AND fingerprint=OLD.fingerprint; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_device_state_changed_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER crm_device_invalidate BEFORE UPDATE ON public.crm_browser_devices FOR EACH ROW EXECUTE FUNCTION public.crm_device_state_changed_v1();
CREATE FUNCTION public.crm_member_disabled_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF OLD.uid IS DISTINCT FROM NEW.uid THEN RAISE EXCEPTION 'Member identity is immutable'; END IF;
 IF OLD.enabled AND NOT NEW.enabled THEN
  UPDATE public.crm_browser_devices SET state='revoked' WHERE uid=OLD.uid AND state<>'revoked';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_member_disabled_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER crm_member_disable_devices AFTER UPDATE ON public.crm_access_members FOR EACH ROW EXECUTE FUNCTION public.crm_member_disabled_v1();
-- All consumer calls come from the SDK cloud-function role. The caller's UID
-- is derived from the verified platform invocation, never a browser UID.
CREATE FUNCTION public.crm_device_gateway_v1(p_op text,p_uid text,p_fingerprint text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 dev public.crm_browser_devices%ROWTYPE; challenge public.crm_device_challenges%ROWTYPE; ttl timestamptz;
BEGIN
 IF claims IS NULL OR claims->>'role' IS DISTINCT FROM 'anon' OR claims ? 'sub' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_uid IS NULL OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 -- Serializing enrollment for this individual member prevents concurrent cap bypass.
 IF NOT EXISTS(SELECT 1 FROM public.crm_access_members WHERE uid=p_uid AND enabled FOR UPDATE) THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
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
REVOKE ALL ON FUNCTION public.crm_device_gateway_v1(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_device_gateway_v1(text,text,text,jsonb) TO anon;
COMMIT;
