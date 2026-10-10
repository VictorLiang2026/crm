-- ROLLBACK for 20261010170600. Re-adds the composite FK. It targets
-- persons(legacy_customer_id,id), so persons.legacy_customer_id and the
-- persons_legacy_customer_id_id_unique constraint must be restored first
-- (20261010180000 CL-03 rollback + 20261010170900 rollback). Only apply as part of the
-- full pre-CL-03 reversal chain.
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_customer_person_fk
  FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT;
