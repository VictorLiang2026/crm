-- Refuse rollback while the feature contains pages, registrations, links, or audit history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.activity_registration_audit LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.activity_registration_people LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.activity_registration_submissions LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.activity_registration_pages LIMIT 1) THEN
    RAISE EXCEPTION 'activity registration data exists; export and assess it before rollback';
  END IF;
END $$;

DROP TABLE public.activity_registration_audit;
DROP TABLE public.activity_registration_people;
DROP TABLE public.activity_registration_submissions;
DROP TABLE public.activity_registration_pages;
