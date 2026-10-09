CREATE OR REPLACE FUNCTION public.crm_person_role_sync_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $sync$
DECLARE
  v_ids bigint[] := '{}';
  v_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
      v_ids := v_ids || (SELECT coalesce(array_agg(id), '{}') FROM public.persons
                         WHERE legacy_customer_id = NEW."Id");
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
      v_ids := v_ids || (SELECT coalesce(array_agg(id), '{}') FROM public.persons
                         WHERE legacy_customer_id = OLD."Id");
    END IF;
  ELSIF TG_TABLE_NAME = 'persons' THEN
    -- Only wired to AFTER UPDATE OF legacy_customer_id.
    v_ids := v_ids || NEW.id;
  ELSIF TG_TABLE_NAME = 'activity_participants' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.canonical_person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.canonical_person_id;
    END IF;
  ELSE
    -- recruit_candidates / activity_speakers carry person_id directly.
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
    END IF;
  END IF;

  FOREACH v_id IN ARRAY (
    SELECT array_agg(DISTINCT x) FROM unnest(v_ids) AS x WHERE x IS NOT NULL
  ) LOOP
    PERFORM public.crm_person_roles_derive_v1(v_id);
  END LOOP;
  RETURN NULL;
END $sync$;
