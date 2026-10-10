-- ROLLBACK for 20261010170800. Restores the exact function/trigger created in
-- 20260929160746_recruit_candidate_person.sql. The body references
-- persons.legacy_customer_id and the customers copy columns (customer_name, wx_account,
-- education, additional_info), so apply only inside the full reversal chain
-- (20261010180000 + 20261010164100 rollbacks and pre-CL-02 code) and re-create the
-- composite FK 20261010170610 rollback if that state is required.
CREATE FUNCTION public.recruit_candidate_person_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $sync$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_person_id bigint;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE "Id" = NEW.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate customer does not exist'; END IF;

  SELECT id INTO v_person_id FROM public.persons
  WHERE legacy_customer_id = v_customer."Id";
  IF v_person_id IS NULL THEN
    INSERT INTO public.persons (
      display_name, name_key, phone, wechat, gender, birthday, occupation,
      organization, education, source, notes, legacy_customer_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      v_customer.customer_name,
      lower(regexp_replace(btrim(regexp_replace(translate(v_customer.customer_name, '　', ' '),
        '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
        '[[:space:]]+', ' ', 'g')),
      v_customer.phone, v_customer.wx_account, v_customer.gender,
      v_customer.birthday, v_customer.occupation, NULL,
      v_customer.education, v_customer.source, v_customer.additional_info,
      v_customer."Id", coalesce(v_customer.created_at, now()),
      coalesce(v_customer.updated_at, v_customer.created_at, now()),
      v_customer.deleted_at
    ) ON CONFLICT (legacy_customer_id) DO NOTHING;
    SELECT id INTO v_person_id FROM public.persons
    WHERE legacy_customer_id = v_customer."Id";
  END IF;
  IF v_person_id IS NULL THEN RAISE EXCEPTION 'Candidate Person resolution failed'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.person_id IS NOT NULL AND NEW.person_id <> v_person_id THEN
      RAISE EXCEPTION 'Candidate Person does not match customer';
    END IF;
  ELSIF NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
        AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'Candidate Person cannot be changed independently';
  END IF;
  NEW.person_id := v_person_id;
  RETURN NEW;
END;
$sync$;
REVOKE ALL ON FUNCTION public.recruit_candidate_person_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER recruit_candidate_person_sync_trigger
  BEFORE INSERT OR UPDATE OF customer_id, person_id ON public.recruit_candidates
  FOR EACH ROW EXECUTE FUNCTION public.recruit_candidate_person_sync();
