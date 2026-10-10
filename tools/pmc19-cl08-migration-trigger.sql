-- CL-08 Part 1: DROP bridge trigger (PMC-17 PersonService.updateBasicsWithProjection is the authoritative write path)
DROP TRIGGER IF EXISTS customer_person_identity_bridge_trigger ON public.customers;
