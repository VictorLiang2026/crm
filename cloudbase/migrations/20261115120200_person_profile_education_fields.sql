-- Person profile field rename and one-time migration of legacy values.
-- Scope: public.persons and the public views/functions that depend on it.

CREATE TABLE public.person_profile_field_rename_backup_20261115 (
  person_id bigint PRIMARY KEY,
  original_occupation text,
  original_organization text,
  original_education text,
  migrated_occupation text
);

INSERT INTO public.person_profile_field_rename_backup_20261115
  (person_id, original_occupation, original_organization, original_education)
SELECT id, occupation, organization, education
FROM public.persons
WHERE NULLIF(BTRIM(organization), '') IS NOT NULL
   OR NULLIF(BTRIM(education), '') IS NOT NULL;

ALTER TABLE public.person_profile_field_rename_backup_20261115 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_profile_field_rename_backup_20261115 FROM PUBLIC, anon, authenticated, service_role;

UPDATE public.persons p
SET occupation = concat_ws('；',
      NULLIF(BTRIM(p.occupation), ''),
      CASE WHEN NULLIF(BTRIM(p.organization), '') IS NOT NULL
                 AND BTRIM(p.organization) IS DISTINCT FROM BTRIM(p.occupation)
           THEN '原机构：' || BTRIM(p.organization) END,
      CASE WHEN NULLIF(BTRIM(p.education), '') IS NOT NULL
                 AND BTRIM(p.education) IS DISTINCT FROM BTRIM(p.occupation)
                 AND BTRIM(p.education) IS DISTINCT FROM BTRIM(p.organization)
           THEN '原教育：' || BTRIM(p.education) END),
    organization = NULL,
    education = NULL,
    updated_at = clock_timestamp()
WHERE NULLIF(BTRIM(p.organization), '') IS NOT NULL
   OR NULLIF(BTRIM(p.education), '') IS NOT NULL;

UPDATE public.person_profile_field_rename_backup_20261115 b
SET migrated_occupation = p.occupation
FROM public.persons p
WHERE p.id = b.person_id;

DROP VIEW public.v_recruit_action_directory;
DROP VIEW public.v_recruit_candidates_person_only;
DROP VIEW public.v_recruit_candidates;
DROP VIEW public.v_activity_roster_people;

ALTER TABLE public.persons RENAME COLUMN organization TO graduation_school;
ALTER TABLE public.persons RENAME COLUMN education TO department_or_major;

-- Refresh PL/pgSQL routines that reference the renamed Person columns.
-- API field names are updated with the columns; Node function boundaries retain
-- organization/education aliases for already-open browser clients.
DO $person_field_routines$
DECLARE
  v_name text;
  v_oid oid;
  v_def text;
  v_original text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'crm_customers_page_v1',
    'crm_ocr_parse_execute_v1',
    'crm_ocr_parse_preview_v1',
    'crm_ocr_parse_undo_preview_v1',
    'crm_person_file_v1',
    'crm_person_list_transfer_create_v1',
    'crm_person_profile_save_v1',
    'person_directory_filtered_page_v1',
    'person_directory_page_v1',
    'person_identity_execute_v1',
    'person_identity_execute_with_roster_v1',
    'person_identity_preview_v1',
    'person_trash_page_v1'
  ] LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Expected public routine missing: %', v_name; END IF;
    v_original := pg_get_functiondef(v_oid);
    v_def := v_original;
    IF v_name = 'crm_customers_page_v1' THEN
      v_def := replace(v_def, 'p.organization,', 'p.graduation_school AS organization,');
    ELSIF v_name IN ('person_directory_filtered_page_v1','person_directory_page_v1','person_trash_page_v1') THEN
      v_def := replace(v_def, 'p.organization', 'p.graduation_school AS organization');
    ELSIF v_name = 'crm_person_list_transfer_create_v1' THEN
      v_def := replace(v_def, 'v_roster.organization', '__roster_organization__');
      v_def := regexp_replace(v_def, '\morganization\M', 'graduation_school', 'g');
      v_def := regexp_replace(v_def, '\meducation\M', 'department_or_major', 'g');
      v_def := replace(v_def, '__roster_organization__', 'v_roster.organization');
      v_def := replace(v_def,
        'graduation_school=coalesce(nullif(graduation_school,''),nullif(v_roster.organization,'')),
      department_or_major=coalesce(nullif(department_or_major,''),nullif(v_roster.school,'')),
      updated_at=clock_timestamp()',
        'graduation_school=coalesce(nullif(graduation_school,''),nullif(v_roster.school,'')),
      updated_at=clock_timestamp()');
    ELSIF v_name = 'person_identity_execute_with_roster_v1' THEN
      v_def := replace(v_def, 'r.organization', '__roster_organization__');
      v_def := regexp_replace(v_def, '\morganization\M', 'graduation_school', 'g');
      v_def := regexp_replace(v_def, '\meducation\M', 'department_or_major', 'g');
      v_def := replace(v_def, '__roster_organization__', 'r.organization');
      v_def := regexp_replace(v_def, '^[[:space:]]*department_or_major=.*$', '', 'gm');
    ELSE
      v_def := regexp_replace(v_def, '\morganization\M', 'graduation_school', 'g');
      v_def := regexp_replace(v_def, '\meducation\M', 'department_or_major', 'g');
    END IF;
    IF v_def = v_original THEN RAISE EXCEPTION 'Routine transform did not apply: %', v_name; END IF;
    EXECUTE v_def;
  END LOOP;
END
$person_field_routines$;

CREATE VIEW public.v_activity_roster_people AS
 SELECT r.id,
    p.id AS person_id,
    COALESCE(p.display_name, r.display_name) AS display_name,
    COALESCE(p.name_key, r.name_key) AS name_key,
    r.school,
    CASE WHEN p.id IS NULL THEN r.wechat ELSE p.wechat END AS wechat,
    CASE WHEN p.id IS NULL THEN r.phone ELSE p.phone END AS phone,
    r.organization AS organization,
    r.industry,
    r.graduation_year,
    r.other_info,
    r.version,
    r.updated_at
   FROM public.activity_roster_people r
     LEFT JOIN public.persons p ON p.id = r.person_id AND p.deleted_at IS NULL;
GRANT SELECT ON public.v_activity_roster_people TO service_role;

CREATE VIEW public.v_recruit_candidates AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.gender,
    p.birthday,
    p.phone,
    p.wechat AS wx_account,
    p.occupation,
    c.annual_income,
    p.department_or_major AS education,
    c.mbti,
    p.source,
    p.marital_status,
    p.hobbies,
    c.additional_info,
    rc.recommender_id,
    rc.stage,
    rc.stage_changed_at,
    rc.potential_score,
    rc.potential_reason,
    rc.motivation,
    rc.concerns,
    rc.work_experience,
    rc.family_situation,
    rc.personality_tags,
    rc.career_plan,
    rc.next_action_date,
    rc.next_action,
    rc.activity_history,
    rc.radar_image_file_id,
    rc.radar_image_name,
    rc.winner_report_file_id,
    rc.winner_report_name,
    rc.operator,
    rc.created_at,
    rc.updated_at,
    CASE WHEN rc.stage_changed_at IS NOT NULL THEN EXTRACT(day FROM (now() - rc.stage_changed_at))::integer ELSE NULL::integer END AS idle_days,
    rc.profile,
    rc.person_id,
    rc.recruitment_priority
   FROM public.recruit_candidates rc
     LEFT JOIN public.customers c ON c."Id" = rc.customer_id AND c.deleted_at IS NULL
     LEFT JOIN public.persons p ON p.id = rc.person_id AND p.deleted_at IS NULL
  WHERE rc.deleted_at IS NULL;
GRANT SELECT ON public.v_recruit_candidates TO anon, service_role;

CREATE VIEW public.v_recruit_candidates_person_only AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.gender,
    p.birthday,
    p.phone,
    p.wechat AS wx_account,
    p.occupation,
    c.annual_income,
    p.department_or_major AS education,
    c.mbti,
    p.source,
    p.marital_status,
    p.hobbies,
    c.additional_info,
    rc.recommender_id,
    rc.stage,
    rc.stage_changed_at,
    rc.potential_score,
    rc.potential_reason,
    rc.motivation,
    rc.concerns,
    rc.work_experience,
    rc.family_situation,
    rc.personality_tags,
    rc.career_plan,
    rc.next_action_date,
    rc.next_action,
    rc.activity_history,
    rc.radar_image_file_id,
    rc.radar_image_name,
    rc.winner_report_file_id,
    rc.winner_report_name,
    rc.operator,
    rc.created_at,
    rc.updated_at,
    CASE WHEN rc.stage_changed_at IS NOT NULL THEN EXTRACT(day FROM (now() - rc.stage_changed_at))::integer ELSE NULL::integer END AS idle_days,
    rc.profile,
    rc.person_id,
    rc.recruitment_priority
   FROM public.recruit_candidates rc
     JOIN public.persons p ON p.id = rc.person_id AND p.deleted_at IS NULL
     LEFT JOIN public.customers c ON c."Id" = rc.customer_id
  WHERE rc.deleted_at IS NULL AND rc.customer_id IS NULL;
GRANT SELECT ON public.v_recruit_candidates_person_only TO service_role;

CREATE VIEW public.v_recruit_action_directory AS
 SELECT r.candidate_id,
    r.person_id,
    r.customer_id,
    r.customer_name,
    r.occupation,
    r.stage,
    r.potential_score,
    r.recruitment_priority,
    r.updated_at,
    r.idle_days,
    CASE WHEN a.id IS NULL THEN r.next_action
         WHEN a.status = ANY (ARRAY['open'::text, 'in_progress'::text]) THEN a.title
         ELSE NULL::text END AS next_action,
    CASE WHEN a.id IS NULL THEN r.next_action_date
         WHEN a.status = ANY (ARRAY['open'::text, 'in_progress'::text]) THEN (a.due_at AT TIME ZONE 'Asia/Shanghai'::text)::date
         ELSE NULL::date END AS next_action_date,
    a.id AS action_id,
    a.status AS action_status
   FROM ((SELECT v_recruit_candidates.candidate_id,
            v_recruit_candidates.person_id,
            v_recruit_candidates.customer_id,
            v_recruit_candidates.customer_name,
            v_recruit_candidates.occupation,
            v_recruit_candidates.stage,
            v_recruit_candidates.potential_score,
            v_recruit_candidates.recruitment_priority,
            v_recruit_candidates.updated_at,
            v_recruit_candidates.idle_days,
            v_recruit_candidates.next_action,
            v_recruit_candidates.next_action_date
           FROM public.v_recruit_candidates
          WHERE v_recruit_candidates.customer_id IS NOT NULL
        UNION ALL
         SELECT v_recruit_candidates_person_only.candidate_id,
            v_recruit_candidates_person_only.person_id,
            v_recruit_candidates_person_only.customer_id,
            v_recruit_candidates_person_only.customer_name,
            v_recruit_candidates_person_only.occupation,
            v_recruit_candidates_person_only.stage,
            v_recruit_candidates_person_only.potential_score,
            v_recruit_candidates_person_only.recruitment_priority,
            v_recruit_candidates_person_only.updated_at,
            v_recruit_candidates_person_only.idle_days,
            v_recruit_candidates_person_only.next_action,
            v_recruit_candidates_person_only.next_action_date
           FROM public.v_recruit_candidates_person_only
          WHERE v_recruit_candidates_person_only.customer_id IS NULL) r
     LEFT JOIN public.v_next_context_action a ON a.kind = 'candidate'::text AND a.target_id = r.candidate_id AND a.person_id = r.person_id);
GRANT SELECT ON public.v_recruit_action_directory TO service_role;
