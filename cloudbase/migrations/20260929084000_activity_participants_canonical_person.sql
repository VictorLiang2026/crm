-- Add an optional canonical Person link without changing legacy participant identity.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.activity_participants
  ADD COLUMN canonical_person_id bigint;
ALTER TABLE public.activity_participants
  ADD CONSTRAINT activity_participants_canonical_person_fk
  FOREIGN KEY (canonical_person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;

-- Only active, unambiguous legacy identities are mapped. Names are never used.
UPDATE public.activity_participants AS ap SET canonical_person_id = p.id
FROM public.customers AS c
JOIN public.persons AS p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NULL AND ap.person_type = 'customer'
  AND ap.person_id = c."Id" AND c.deleted_at IS NULL;

UPDATE public.activity_participants AS ap SET canonical_person_id = p.id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id AND c.deleted_at IS NULL
JOIN public.persons AS p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NULL AND ap.person_type = 'recruit'
  AND ap.person_id = rc.id AND rc.deleted_at IS NULL;

UPDATE public.activity_participants AS ap SET canonical_person_id = p.id
FROM public.activity_speakers AS s
JOIN public.customers AS c ON c."Id" = s.customer_id AND c.deleted_at IS NULL
JOIN public.persons AS p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NULL AND ap.person_type = 'speaker'
  AND ap.person_id = s.id AND s.deleted_at IS NULL;

CREATE UNIQUE INDEX activity_participants_canonical_active_uq
  ON public.activity_participants(activity_id, canonical_person_id)
  WHERE deleted_at IS NULL AND canonical_person_id IS NOT NULL;

-- Legacy anonymous functions may keep updating their existing fields, but cannot
-- assign or replace the canonical identity. Only the logged-in service path can.
CREATE FUNCTION public.activity_participants_canonical_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.canonical_person_id IS NOT NULL AND current_user <> 'service_role' THEN
      RAISE EXCEPTION 'canonical_person_id requires service_role';
    END IF;
  ELSIF NEW.canonical_person_id IS DISTINCT FROM OLD.canonical_person_id
        AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'canonical_person_id requires service_role';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER activity_participants_canonical_guard_trigger
  BEFORE INSERT OR UPDATE ON public.activity_participants
  FOR EACH ROW EXECUTE FUNCTION public.activity_participants_canonical_guard();
COMMIT;
