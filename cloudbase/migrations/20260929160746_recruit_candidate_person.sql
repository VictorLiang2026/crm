-- Keep the legacy Recruit Candidate profile and attach its explicit customer identity to Person.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'recruit_candidates'
               AND column_name = 'person_id') THEN
    RAISE EXCEPTION 'public.recruit_candidates.person_id already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.persons'::regclass
                   AND conname = 'persons_legacy_customer_id_id_unique') THEN
    RAISE EXCEPTION 'persons customer/Person identity constraint is missing';
  END IF;
END $guard$;

ALTER TABLE public.recruit_candidates ADD COLUMN person_id bigint;

-- Import only customers explicitly referenced by a candidate. A matching name
-- alone never selects or merges a Person. Existing Person rows are not changed.
INSERT INTO public.persons (
  display_name, name_key, phone, wechat, gender, birthday, occupation,
  organization, education, source, notes, legacy_customer_id,
  created_at, updated_at, deleted_at
)
SELECT DISTINCT
  c.customer_name,
  lower(regexp_replace(btrim(regexp_replace(translate(c.customer_name, '　', ' '),
    '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
    '[[:space:]]+', ' ', 'g')),
  c.phone, c.wx_account, c.gender, c.birthday, c.occupation,
  NULL, c.education, c.source, c.additional_info, c."Id",
  coalesce(c.created_at, now()), coalesce(c.updated_at, c.created_at, now()), c.deleted_at
FROM public.customers AS c
JOIN public.recruit_candidates AS rc ON rc.customer_id = c."Id"
LEFT JOIN public.persons AS p ON p.legacy_customer_id = c."Id"
WHERE p.id IS NULL
ON CONFLICT (legacy_customer_id) DO NOTHING;

UPDATE public.recruit_candidates AS rc SET person_id = p.id
FROM public.persons AS p
WHERE p.legacy_customer_id = rc.customer_id AND rc.person_id IS NULL;

DO $complete$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recruit_candidates AS rc
             LEFT JOIN public.persons AS p
               ON p.id = rc.person_id AND p.legacy_customer_id = rc.customer_id
             WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Candidate Person backfill incomplete';
  END IF;
END $complete$;

ALTER TABLE public.recruit_candidates ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE public.recruit_candidates
  ADD CONSTRAINT recruit_candidates_person_fk
  FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;
ALTER TABLE public.recruit_candidates
  ADD CONSTRAINT recruit_candidates_customer_person_fk
  FOREIGN KEY (customer_id, person_id)
  REFERENCES public.persons(legacy_customer_id, id) ON DELETE RESTRICT;
CREATE INDEX recruit_candidates_person_id_idx ON public.recruit_candidates(person_id);

-- The legacy function still writes through its existing anon RDB path. This
-- narrowly scoped trigger derives the link from customer_id in the same write
-- transaction; direct callers cannot select an unrelated Person ID.
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

-- Append only; keep existing columns/order, invoker security and old API reads.
CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.gender,
       c.birthday, c.phone, c.wx_account, c.occupation, c.annual_income,
       c.education, c.mbti, c.source, c.marital_status, c.hobbies,
       c.additional_info, rc.recommender_id, rc.stage, rc.stage_changed_at,
       rc.potential_score, rc.potential_reason, rc.motivation, rc.concerns,
       rc.work_experience, rc.family_situation, rc.personality_tags,
       rc.career_plan, rc.next_action_date, rc.next_action, rc.activity_history,
       rc.radar_image_file_id, rc.radar_image_name, rc.winner_report_file_id,
       rc.winner_report_name, rc.operator, rc.created_at, rc.updated_at,
       CASE WHEN rc.stage_changed_at IS NOT NULL
            THEN EXTRACT(DAY FROM now() - rc.stage_changed_at)::integer
            ELSE NULL::integer END AS idle_days,
       rc.profile, rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NULL AND c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.phone,
       c.occupation, rc.stage, rc.operator, rc.created_at, rc.updated_at,
       rc.deleted_at AS candidate_deleted_at, c.deleted_at AS customer_deleted_at,
       rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NOT NULL;

REVOKE ALL ON public.v_recruit_candidates, public.v_recruit_candidates_trash
  FROM PUBLIC, authenticated;
GRANT SELECT ON public.v_recruit_candidates, public.v_recruit_candidates_trash
  TO anon, service_role;
COMMENT ON COLUMN public.recruit_candidates.person_id IS
  'Canonical Person resolved only through the explicit candidate customer_id link';
COMMIT;
