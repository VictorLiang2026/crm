BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION public.crm_recruit_candidate_transition_v1(text,bigint,bigint,timestamptz,text,text,text);
DROP FUNCTION public.crm_recruit_candidate_create_v1(text,bigint,text,text);

COMMIT;
