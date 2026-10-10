-- ROLLBACK for 20261010190000_pmc20_fix_actions_guard.sql
-- Restores the exact pre-PMC-20 function body. WARNING: this body references
-- persons.legacy_customer_id, dropped by PMC-19 CL-03 (20261010180000). Applying this
-- rollback alone makes the opportunity ownership branch fail at runtime; it is only
-- meaningful together with 20261010180000_pmc19_cl03_drop_legacy_customer_id.rollback.sql.
CREATE OR REPLACE FUNCTION public.actions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.person_id, NEW.opportunity_id, NEW.interaction_id, NEW.activity_id,
        NEW.source, NEW.created_by_uid, NEW.confirmed_by_uid, NEW.confirmed_at)
       IS DISTINCT FROM
       (OLD.person_id, OLD.opportunity_id, OLD.interaction_id, OLD.activity_id,
        OLD.source, OLD.created_by_uid, OLD.confirmed_by_uid, OLD.confirmed_at) THEN
      RAISE EXCEPTION 'action identity, links and provenance are immutable'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.interaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interactions AS i
    WHERE i.id = NEW.interaction_id AND i.person_id = NEW.person_id
  ) THEN
    RAISE EXCEPTION 'action interaction belongs to another Person'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.opportunities AS o
    JOIN public.persons AS p ON p.id = NEW.person_id
    WHERE o.id = NEW.opportunity_id AND
      (o.person_id = NEW.person_id OR o.customer_id = p.legacy_customer_id)
  ) THEN
    RAISE EXCEPTION 'action opportunity belongs to another Person'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
