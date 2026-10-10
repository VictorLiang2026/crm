-- CL-09 Part 1: DROP recruit person sync trigger (recruit create requires customer_id, person_id inherited from customer)
DROP TRIGGER IF EXISTS recruit_candidate_person_sync_trigger ON public.recruit_candidates;
