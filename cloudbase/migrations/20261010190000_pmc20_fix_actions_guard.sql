-- PMC-20 compatibility fix: actions_guard still referenced dropped persons.legacy_customer_id
-- (column dropped by PMC-19 CL-03), making every actions INSERT/UPDATE fail the opportunity
-- ownership check at runtime. Customer link is now resolved via customers.person_id.
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
    WHERE o.id = NEW.opportunity_id AND
      (o.person_id = NEW.person_id
       OR EXISTS (SELECT 1 FROM public.customers AS c
                  WHERE c."Id" = o.customer_id AND c.person_id = NEW.person_id))
  ) THEN
    RAISE EXCEPTION 'action opportunity belongs to another Person'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
