BEGIN;
SET LOCAL lock_timeout='3s';

CREATE TABLE public.crm_knowledge_mcp_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL,
  redirect_uri text NOT NULL,
  token_endpoint_auth_method text NOT NULL CHECK (token_endpoint_auth_method='none'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (redirect_uri='https://chatgpt.com/connector_platform_oauth_redirect' OR redirect_uri ~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,80}$')
);
ALTER TABLE public.crm_knowledge_mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_knowledge_mcp_clients FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_knowledge_mcp_clients_service_only ON public.crm_knowledge_mcp_clients FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_knowledge_mcp_clients FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_knowledge_mcp_clients TO service_role;

CREATE TABLE public.crm_knowledge_mcp_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  client_id text NOT NULL,
  actor_uid text NOT NULL,
  redirect_uri text NOT NULL,
  resource_uri text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  state text NOT NULL CHECK (state IN ('authorization_code','active','revoked')),
  code_hash text,
  code_challenge text,
  code_challenge_method text,
  code_expires_at timestamptz,
  access_hash text,
  access_expires_at timestamptz,
  refresh_hash text,
  previous_refresh_hash text,
  previous_refresh_hashes text[] NOT NULL DEFAULT ARRAY[]::text[],
  refresh_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT crm_knowledge_mcp_grants_scopes_check CHECK (scopes <@ ARRAY['knowledge:read','knowledge:source:read','knowledge:gpt:submit']::text[])
);
CREATE UNIQUE INDEX crm_knowledge_mcp_code_hash_uq ON public.crm_knowledge_mcp_grants(code_hash) WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX crm_knowledge_mcp_access_hash_uq ON public.crm_knowledge_mcp_grants(access_hash) WHERE access_hash IS NOT NULL;
CREATE UNIQUE INDEX crm_knowledge_mcp_refresh_hash_uq ON public.crm_knowledge_mcp_grants(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX crm_knowledge_mcp_actor_idx ON public.crm_knowledge_mcp_grants(actor_uid,created_at DESC);
ALTER TABLE public.crm_knowledge_mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_knowledge_mcp_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_knowledge_mcp_grants_service_only ON public.crm_knowledge_mcp_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_knowledge_mcp_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_knowledge_mcp_grants TO service_role;

CREATE OR REPLACE FUNCTION public.crm_knowledge_mcp_oauth_v1(p_operation text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' AS $f$
DECLARE r public.crm_knowledge_mcp_grants%ROWTYPE; family uuid;
BEGIN
 IF current_user<>'service_role' OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_ACCESS_DENIED'; END IF;
 IF p_operation='register' THEN
  IF jsonb_typeof(p_data->'redirectUris') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'redirectUris')<>1 OR
     (p_data->'redirectUris'->>0<>'https://chatgpt.com/connector_platform_oauth_redirect' AND p_data->'redirectUris'->>0 !~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,80}$') THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
  INSERT INTO public.crm_knowledge_mcp_clients(client_id,client_name,redirect_uri,token_endpoint_auth_method)
  VALUES(p_data->>'clientId',left(coalesce(nullif(p_data->>'clientName',''),'CRM Knowledge MCP'),100),p_data->'redirectUris'->>0,'none');
  RETURN jsonb_build_object('ok',true,'clientId',p_data->>'clientId','redirectUri',p_data->'redirectUris'->>0);
 ELSIF p_operation='validate_client' THEN
  IF NOT EXISTS(SELECT 1 FROM public.crm_knowledge_mcp_clients WHERE client_id=p_data->>'clientId' AND redirect_uri=p_data->>'redirectUri') THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='issue' THEN
  IF NOT EXISTS(SELECT 1 FROM public.crm_knowledge_mcp_clients WHERE client_id=p_data->>'clientId' AND redirect_uri=p_data->>'redirectUri') THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
  INSERT INTO public.crm_knowledge_mcp_grants(family_id,client_id,actor_uid,redirect_uri,resource_uri,scopes,state,code_hash,code_challenge,code_challenge_method,code_expires_at)
  VALUES((p_data->>'familyId')::uuid,p_data->>'clientId',p_data->>'actorUid',p_data->>'redirectUri',p_data->>'resource',ARRAY(SELECT jsonb_array_elements_text(p_data->'scopes')),
    'authorization_code',p_data->>'codeHash',p_data->>'codeChallenge',p_data->>'codeChallengeMethod',clock_timestamp()+interval '5 minutes') RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'expiresAt',r.code_expires_at);
 ELSIF p_operation='exchange' THEN
  SELECT * INTO r FROM public.crm_knowledge_mcp_grants WHERE code_hash=p_data->>'codeHash' FOR UPDATE;
  IF NOT FOUND OR r.state<>'authorization_code' OR r.code_expires_at<clock_timestamp() OR r.client_id<>p_data->>'clientId' OR r.redirect_uri<>p_data->>'redirectUri' OR r.resource_uri<>p_data->>'resource' THEN RAISE EXCEPTION 'MCP_INVALID_GRANT'; END IF;
  IF r.code_challenge_method<>'S256' OR r.code_challenge<>p_data->>'codeChallenge' THEN RAISE EXCEPTION 'MCP_INVALID_GRANT'; END IF;
  UPDATE public.crm_knowledge_mcp_grants SET state='active',code_hash=NULL,code_challenge=NULL,code_expires_at=NULL,
    access_hash=p_data->>'accessHash',access_expires_at=clock_timestamp()+interval '15 minutes',refresh_hash=p_data->>'refreshHash',
    refresh_expires_at=clock_timestamp()+interval '30 days',updated_at=clock_timestamp() WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'actorUid',r.actor_uid,'familyId',r.family_id,'scopes',r.scopes,'resource',r.resource_uri);
 ELSIF p_operation='access' THEN
  SELECT * INTO r FROM public.crm_knowledge_mcp_grants WHERE access_hash=p_data->>'accessHash' AND state='active' AND access_expires_at>clock_timestamp() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_INVALID_TOKEN'; END IF;
  RETURN jsonb_build_object('ok',true,'actorUid',r.actor_uid,'familyId',r.family_id,'clientId',r.client_id,'scopes',r.scopes,'resource',r.resource_uri,'expiresAt',r.access_expires_at);
 ELSIF p_operation='refresh' THEN
  SELECT * INTO r FROM public.crm_knowledge_mcp_grants WHERE refresh_hash=p_data->>'refreshHash' AND client_id=p_data->>'clientId' AND resource_uri=p_data->>'resource' AND state='active' AND refresh_expires_at>clock_timestamp() AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
   SELECT family_id INTO family FROM public.crm_knowledge_mcp_grants WHERE (previous_refresh_hash=p_data->>'refreshHash' OR p_data->>'refreshHash'=ANY(previous_refresh_hashes)) AND state='active' FOR UPDATE;
   IF family IS NOT NULL THEN UPDATE public.crm_knowledge_mcp_grants SET state='revoked',revoked_at=clock_timestamp(),access_hash=NULL,refresh_hash=NULL,updated_at=clock_timestamp() WHERE family_id=family; END IF;
   RAISE EXCEPTION 'MCP_INVALID_GRANT';
  END IF;
  UPDATE public.crm_knowledge_mcp_grants SET previous_refresh_hash=refresh_hash,previous_refresh_hashes=array_append(previous_refresh_hashes,refresh_hash),refresh_hash=p_data->>'newRefreshHash',access_hash=p_data->>'newAccessHash',
    access_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'actorUid',r.actor_uid,'familyId',r.family_id,'clientId',r.client_id,'scopes',r.scopes,'resource',r.resource_uri);
 ELSIF p_operation='revoke' THEN
  UPDATE public.crm_knowledge_mcp_grants SET state='revoked',revoked_at=clock_timestamp(),access_hash=NULL,refresh_hash=NULL,updated_at=clock_timestamp()
   WHERE state<>'revoked' AND ((p_data ? 'familyId' AND family_id=(p_data->>'familyId')::uuid) OR
     (client_id=p_data->>'clientId' AND (access_hash=p_data->>'tokenHash' OR refresh_hash=p_data->>'tokenHash')));
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION 'MCP_INVALID_OPERATION';
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_mcp_oauth_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_mcp_oauth_v1(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_knowledge_gpt_queue_v1(p_actor_uid text,p_table text,p_id bigint,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' AS $f$
DECLARE old jsonb; source_id bigint; current_at timestamptz; gpt_text text; gpt_summary text; part text; cmd uuid; source_status text;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid))=0 OR p_table IS DISTINCT FROM 'knowledge_items' OR p_id<=0 THEN RAISE EXCEPTION 'CONTENT_ACCESS_DENIED'; END IF;
 EXECUTE format('SELECT source_id,updated_at FROM public.%I WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',p_table) INTO source_id,current_at USING p_id;
 IF current_at IS NULL OR current_at<>p_expected_updated_at THEN RAISE EXCEPTION 'CONTENT_STALE'; END IF;
 IF source_id IS NULL THEN RAISE EXCEPTION 'SOURCE_UNAVAILABLE'; END IF;
 SELECT lifecycle_status INTO source_status FROM public.knowledge_sources WHERE id=source_id AND deleted_at IS NULL;
 IF source_status IS NULL OR source_status IN ('invalidated','superseded') THEN RAISE EXCEPTION 'SOURCE_UNAVAILABLE'; END IF;
 old=public.crm_knowledge_content_snapshot_v1(p_table,p_id);
 gpt_text=old#>>'{gpt,text}'; gpt_summary=old#>>'{gpt,summary}';
 IF nullif(btrim(gpt_text),'') IS NOT NULL AND nullif(btrim(gpt_summary),'') IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'skipped',true,'reason','ALREADY_COMPLETE'); END IF;
 IF EXISTS(SELECT 1 FROM public.knowledge_content_commands WHERE record_table=p_table AND record_id=p_id AND status='pending_review') THEN
  RETURN jsonb_build_object('ok',true,'skipped',true,'reason','PENDING_EXISTS');
 END IF;
 part=CASE WHEN nullif(btrim(gpt_text),'') IS NULL AND nullif(btrim(gpt_summary),'') IS NULL THEN 'both'
   WHEN nullif(btrim(gpt_text),'') IS NULL THEN 'text' ELSE 'summary' END;
 INSERT INTO public.knowledge_content_commands(actor_uid,record_table,record_id,expected_updated_at,operation,status,before_state,payload)
 VALUES(p_actor_uid,p_table,p_id,current_at,'regenerate','queued',old,jsonb_build_object('part',part,'target','gpt','stage','extract','sourceId',source_id)) RETURNING id INTO cmd;
 RETURN jsonb_build_object('ok',true,'commandId',cmd,'status','queued','part',part,'target','gpt');
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_gpt_queue_v1(text,text,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_gpt_queue_v1(text,text,bigint,timestamptz) TO service_role;
COMMIT;
