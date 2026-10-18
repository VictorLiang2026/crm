-- PC28 safe rollback: stop execution while retaining command and batch audit.
-- Deploy the previous Assistant/Console code separately. No business rows are restored here.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE INSERT,UPDATE ON public.assistant_recruit_delete_commands FROM service_role;
CREATE OR REPLACE FUNCTION public.assistant_recruit_delete_command_v1(
  p_stage text,p_actor_uid text,p_command_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,p_person_id bigint DEFAULT NULL,
  p_candidate_id bigint DEFAULT NULL,p_request_text text DEFAULT NULL,
  p_person_mention text DEFAULT NULL,p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $function$
BEGIN
  RAISE EXCEPTION 'PC28 recruit delete executor disabled' USING ERRCODE='42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) TO service_role;
COMMIT;
