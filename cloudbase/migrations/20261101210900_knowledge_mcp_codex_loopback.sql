BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION public.crm_knowledge_mcp_redirect_uri_allowed_v1(p_uri text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $f$
DECLARE port_text text;
BEGIN
  IF p_uri IS NULL THEN RETURN false; END IF;
  IF p_uri='https://chatgpt.com/connector_platform_oauth_redirect' OR
     p_uri ~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,80}$' THEN RETURN true; END IF;
  IF p_uri !~ '^http://127\.0\.0\.1(:[1-9][0-9]{0,4})?/callback$' THEN RETURN false; END IF;
  port_text=substring(p_uri from '^http://127\.0\.0\.1:([1-9][0-9]{0,4})/callback$');
  RETURN port_text IS NULL OR port_text::integer<=65535;
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_mcp_redirect_uri_allowed_v1(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_mcp_redirect_uri_allowed_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_knowledge_mcp_redirect_uri_matches_v1(p_registered text,p_requested text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $f$
  SELECT p_registered=p_requested OR
    (public.crm_knowledge_mcp_redirect_uri_allowed_v1(p_registered) AND
     public.crm_knowledge_mcp_redirect_uri_allowed_v1(p_requested) AND
     p_registered ~ '^http://127\.0\.0\.1(:[1-9][0-9]{0,4})?/callback$' AND
     p_requested ~ '^http://127\.0\.0\.1(:[1-9][0-9]{0,4})?/callback$')
$f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_mcp_redirect_uri_matches_v1(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_mcp_redirect_uri_matches_v1(text,text) TO service_role;

ALTER TABLE public.crm_knowledge_mcp_clients DROP CONSTRAINT crm_knowledge_mcp_clients_redirect_uri_check;
ALTER TABLE public.crm_knowledge_mcp_clients ADD CONSTRAINT crm_knowledge_mcp_clients_redirect_uri_check
  CHECK (public.crm_knowledge_mcp_redirect_uri_allowed_v1(redirect_uri));

CREATE OR REPLACE FUNCTION public.crm_knowledge_mcp_oauth_v1(p_operation text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' AS $f$
DECLARE r public.crm_knowledge_mcp_grants%ROWTYPE; family uuid;
BEGIN
 IF current_user<>'service_role' OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_ACCESS_DENIED'; END IF;
 IF p_operation='register' THEN
  IF jsonb_typeof(p_data->'redirectUris') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'redirectUris')<>1 OR
     NOT public.crm_knowledge_mcp_redirect_uri_allowed_v1(p_data->'redirectUris'->>0) THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
  INSERT INTO public.crm_knowledge_mcp_clients(client_id,client_name,redirect_uri,token_endpoint_auth_method)
  VALUES(p_data->>'clientId',left(coalesce(nullif(p_data->>'clientName',''),'CRM Knowledge MCP'),100),p_data->'redirectUris'->>0,'none');
  RETURN jsonb_build_object('ok',true,'clientId',p_data->>'clientId','redirectUri',p_data->'redirectUris'->>0);
 ELSIF p_operation='validate_client' THEN
  IF NOT EXISTS(SELECT 1 FROM public.crm_knowledge_mcp_clients WHERE client_id=p_data->>'clientId' AND
      public.crm_knowledge_mcp_redirect_uri_matches_v1(redirect_uri,p_data->>'redirectUri')) THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='issue' THEN
  IF NOT EXISTS(SELECT 1 FROM public.crm_knowledge_mcp_clients WHERE client_id=p_data->>'clientId' AND
      public.crm_knowledge_mcp_redirect_uri_matches_v1(redirect_uri,p_data->>'redirectUri')) THEN RAISE EXCEPTION 'MCP_INVALID_CLIENT'; END IF;
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
COMMIT;
