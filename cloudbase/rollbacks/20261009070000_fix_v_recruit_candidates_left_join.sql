-- Rollback: 回滚 G-PMC11-2 修复，恢复 v_recruit_candidates / v_recruit_candidates_trash 为 INNER JOIN 版本
-- 对应 migration: cloudbase/migrations/20261009070000_fix_v_recruit_candidates_left_join.sql
-- 说明: 恢复 2026-10-09 修复前的视图定义（INNER JOIN customers，独立候选人不可见）。
--       回滚仅改变视图可见范围，不产生数据写入；修复期间若有针对独立候选人的 AI 输出（建议/评分回写），
--       属业务数据，不在本回滚范围内。
-- 注意: 回滚后独立候选人（如 candidate_id=20）再次对招募工作台/AI 函数不可见（恢复缺陷状态）。

BEGIN;

CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    c.customer_name,
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
  JOIN customers c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NULL AND c.deleted_at IS NULL;

COMMENT ON VIEW public.v_recruit_candidates IS '增员候选人完整视图（JOIN customers，含评估附件字段）';

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    c.customer_name,
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
  JOIN customers c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NOT NULL;

COMMENT ON VIEW public.v_recruit_candidates_trash IS '增员回收站视图（软删除候选人+客户基础信息；customer_deleted_at 用于"随客户删除"标识）';

GRANT SELECT ON public.v_recruit_candidates TO anon, authenticated, service_role;
GRANT SELECT ON public.v_recruit_candidates_trash TO anon, authenticated, service_role;

COMMIT;
