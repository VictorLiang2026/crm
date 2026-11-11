-- Public activity registration is isolated from CloudBase user identities.
-- CRM clients and the public page access these rows only through the dedicated
-- activity_registration function using its server-only service_role API key.
BEGIN;

CREATE TABLE public.activity_registration_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id bigint NOT NULL UNIQUE REFERENCES public.activities(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  form_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(form_schema) = 'array'),
  capacity integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.activity_registration_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.activity_registration_pages(id) ON DELETE RESTRICT,
  attendee_name text NOT NULL CHECK (length(btrim(attendee_name)) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40),
  wechat text CHECK (wechat IS NULL OR length(wechat) BETWEEN 1 AND 100),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  management_token_hash char(64) NOT NULL UNIQUE CHECK (management_token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','waitlisted','withdrawn')),
  notification_status text NOT NULL DEFAULT 'not_sent' CHECK (notification_status IN ('not_sent','sent','failed')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_registration_submissions_page_created_idx
  ON public.activity_registration_submissions(page_id, created_at DESC, id);
CREATE INDEX activity_registration_submissions_review_idx
  ON public.activity_registration_submissions(status, created_at DESC, id);

CREATE TABLE public.activity_registration_people (
  id bigserial PRIMARY KEY,
  submission_id uuid NOT NULL UNIQUE REFERENCES public.activity_registration_submissions(id) ON DELETE RESTRICT,
  activity_id bigint NOT NULL REFERENCES public.activities(id) ON DELETE RESTRICT,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, person_id)
);
CREATE INDEX activity_registration_people_person_idx
  ON public.activity_registration_people(person_id, linked_at DESC, id);
CREATE INDEX activity_registration_people_activity_idx
  ON public.activity_registration_people(activity_id, linked_at DESC, id);

CREATE TABLE public.activity_registration_audit (
  id bigserial PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.activity_registration_submissions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('submitted','updated_by_attendee','approved','rejected','waitlisted','notification_marked','management_link_reissued','person_linked','person_unlinked')),
  actor_uid text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_registration_audit_submission_idx
  ON public.activity_registration_audit(submission_id, created_at DESC, id);

ALTER TABLE public.activity_registration_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_people FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_registration_pages_service_only ON public.activity_registration_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_submissions_service_only ON public.activity_registration_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_people_service_only ON public.activity_registration_people
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY activity_registration_audit_service_only ON public.activity_registration_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.activity_registration_pages,
  public.activity_registration_submissions,
  public.activity_registration_people,
  public.activity_registration_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.activity_registration_pages,
  public.activity_registration_submissions,
  public.activity_registration_people,
  public.activity_registration_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.activity_registration_people_id_seq,
  public.activity_registration_audit_id_seq TO service_role;

COMMIT;
