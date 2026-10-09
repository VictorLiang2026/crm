-- Rollback: PMC-12 招募域读切换回滚 —— 恢复 G-PMC11-2 修复后的视图定义（customers 优先，persons 兜底姓名）
-- 对应 migration: cloudbase/migrations/20261009091200_pmc12_recruit_view_person_read.sql
-- 说明: 纯视图定义切换，无数据修改；回滚后 customer_name 等基础字段恢复为 customers 副本优先。

BEGIN;

CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    COALESCE(c.customer_name, p.display_name) AS customer_name,
    c.gender,
    c.birthday,
    c.phone,
    c.wx_account,
    c.occupation,
    c.annual_income,
    c.education,
    c.mbti,
    c.source,
    c.marital_status,
    c.hobbies,
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
    CASE
        WHEN rc.stage_changed_at IS NOT NULL THEN EXTRACT(day FROM now() - rc.stage_changed_at)::integer
        ELSE NULL::integer
    END AS idle_days,
    rc.profile,
    rc.person_id
FROM recruit_candidates rc
  LEFT JOIN customers c ON c."Id" = rc.customer_id AND c.deleted_at IS NULL
  LEFT JOIN persons p ON p.id = rc.person_id AND p.deleted_at IS NULL
WHERE rc.deleted_at IS NULL;

COMMENT ON VIEW public.v_recruit_candidates IS '增员候选人完整视图（LEFT JOIN customers + persons 兜底姓名，含独立候选人；G-PMC11-2 修复 2026-10-09）';

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    COALESCE(c.customer_name, p.display_name) AS customer_name,
    c.phone,
    c.occupation,
    rc.stage,
    rc.operator,
    rc.created_at,
    rc.updated_at,
    rc.deleted_at AS candidate_deleted_at,
    c.deleted_at AS customer_deleted_at,
    rc.person_id
FROM recruit_candidates rc
  LEFT JOIN customers c ON c."Id" = rc.customer_id
  LEFT JOIN persons p ON p.id = rc.person_id AND p.deleted_at IS NULL
WHERE rc.deleted_at IS NOT NULL;

COMMENT ON VIEW public.v_recruit_candidates_trash IS '增员回收站视图（LEFT JOIN customers + persons 兜底姓名，含独立候选人；customer_deleted_at 用于"随客户删除"标识；G-PMC11-2 修复 2026-10-09）';

GRANT SELECT ON public.v_recruit_candidates TO anon, authenticated, service_role;
GRANT SELECT ON public.v_recruit_candidates_trash TO anon, authenticated, service_role;

COMMIT;
