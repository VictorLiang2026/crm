-- Remove the atomic Person edit endpoint. No table data or existing objects are changed.
DROP FUNCTION IF EXISTS public.crm_person_profile_save_v1(
  text,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb
);
