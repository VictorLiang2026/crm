-- Speaker is a professional profile; Person is the canonical identity.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.activity_speakers
  ADD COLUMN person_id bigint;
ALTER TABLE public.activity_speakers
  ADD CONSTRAINT activity_speakers_person_fk
  FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;

-- Link only active speakers with an explicit, unique legacy customer mapping.
-- Never infer identity from a matching name.
UPDATE public.activity_speakers AS speaker
SET person_id = person.id
FROM public.persons AS person
JOIN public.customers AS customer
  ON customer."Id" = person.legacy_customer_id
 AND customer.deleted_at IS NULL
WHERE speaker.customer_id = customer."Id"
  AND speaker.deleted_at IS NULL
  AND person.deleted_at IS NULL
  AND speaker.person_id IS NULL;

CREATE UNIQUE INDEX activity_speakers_person_active_idx
  ON public.activity_speakers(person_id)
  WHERE deleted_at IS NULL AND person_id IS NOT NULL;

-- The legacy anonymous function may edit profile fields but cannot choose or
-- change canonical identity. The authenticated Person service uses service_role.
CREATE FUNCTION public.activity_speakers_person_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_id IS NOT NULL AND current_user <> 'service_role' THEN
      RAISE EXCEPTION 'person_id requires service_role';
    END IF;
  ELSIF NEW.person_id IS DISTINCT FROM OLD.person_id
        AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'person_id requires service_role';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER activity_speakers_person_guard_trigger
  BEFORE INSERT OR UPDATE ON public.activity_speakers
  FOR EACH ROW EXECUTE FUNCTION public.activity_speakers_person_guard();

COMMENT ON COLUMN public.activity_speakers.person_id IS
  'Canonical public.persons identity; expertise and cooperation remain in this speaker profile';
COMMIT;
