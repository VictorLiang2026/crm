BEGIN;
REVOKE EXECUTE ON FUNCTION public.crm_person_interaction_v1(text,text,bigint,jsonb) FROM service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
