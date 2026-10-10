-- Rollback: Restore persons.legacy_customer_id column
-- Add column back, backfill from customers.person_id mapping, restore UNIQUE constraint.
-- Full reversal chain continues with 20261010170900 rollback (composite unique + old
-- persons trigger) and 20261010180100 rollback (old crm_person_role_sync_v1 body).
ALTER TABLE public.persons ADD COLUMN legacy_customer_id integer;

-- Backfill: set legacy_customer_id from customers."Id" where person_id matches.
-- All customer rows count, including soft-deleted ones: pre-drop state carried 783 links
-- for 783 customers (PMC-20 drill: 783 distinct links, 0 missing; 1 customer soft-deleted).
UPDATE public.persons p SET legacy_customer_id = c."Id"
FROM public.customers c WHERE c.person_id = p.id;

-- Restore UNIQUE constraint
ALTER TABLE public.persons ADD CONSTRAINT persons_legacy_customer_id_key UNIQUE (legacy_customer_id);
