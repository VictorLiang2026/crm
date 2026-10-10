-- Rollback: Restore persons.legacy_customer_id column
-- Add column back, backfill from customers.person_id mapping, restore UNIQUE constraint
ALTER TABLE public.persons ADD COLUMN legacy_customer_id integer;

-- Backfill: set legacy_customer_id from customers."Id" where person_id matches
UPDATE public.persons p SET legacy_customer_id = c."Id"
FROM public.customers c WHERE c.person_id = p.id AND c.deleted_at IS NULL;

-- Restore UNIQUE constraint
ALTER TABLE public.persons ADD CONSTRAINT persons_legacy_customer_id_key UNIQUE (legacy_customer_id);
