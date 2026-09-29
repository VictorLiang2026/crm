-- Remove the candidate link without deleting any Person identity or business row.
-- DROP VIEW uses RESTRICT: a later dependent object must be reviewed separately.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TRIGGER recruit_candidate_person_sync_trigger ON public.recruit_candidates;
DROP FUNCTION public.recruit_candidate_person_sync();

DROP VIEW public.v_recruit_candidates_trash;
DROP VIEW public.v_recruit_candidates;

CREATE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
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
       rc.profile
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NULL AND c.deleted_at IS NULL;
COMMENT ON VIEW public.v_recruit_candidates IS
  '增员候选人完整视图（JOIN customers，含评估附件字段）';

CREATE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.phone,
       c.occupation, rc.stage, rc.operator, rc.created_at, rc.updated_at,
       rc.deleted_at AS candidate_deleted_at, c.deleted_at AS customer_deleted_at
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NOT NULL;
COMMENT ON VIEW public.v_recruit_candidates_trash IS
  '增员回收站视图（软删除候选人+客户基础信息；customer_deleted_at 用于"随客户删除"标识）';

REVOKE ALL ON public.v_recruit_candidates, public.v_recruit_candidates_trash
  FROM PUBLIC, authenticated;
GRANT SELECT ON public.v_recruit_candidates, public.v_recruit_candidates_trash TO anon;
GRANT ALL ON public.v_recruit_candidates, public.v_recruit_candidates_trash TO service_role;

DROP INDEX public.recruit_candidates_person_id_idx;
ALTER TABLE public.recruit_candidates DROP CONSTRAINT recruit_candidates_customer_person_fk;
ALTER TABLE public.recruit_candidates DROP CONSTRAINT recruit_candidates_person_fk;
ALTER TABLE public.recruit_candidates DROP COLUMN person_id;
COMMIT;
