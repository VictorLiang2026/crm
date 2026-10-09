-- Migration: 修复 G-PMC11-2 —— v_recruit_candidates / v_recruit_candidates_trash 视图 INNER JOIN customers 过滤独立候选人
-- 日期: 2026-10-09
-- 背景: recruit_candidates.customer_id 允许为空（独立候选人，Person 中心化迁移后为一等公民）；
--       两个视图使用 INNER JOIN customers，导致独立候选人对招募工作台 list/get、recruit_recommend、
--       recruit_score、activity_tasks/activity_speakers/activities 姓名回填、ai_parse 匹配、ai_followup 均不可见。
-- 变更（列名/列序/类型全部不变，41 列 / 12 列）:
--   1. JOIN customers → LEFT JOIN customers（主视图将 c.deleted_at IS NULL 移入 JOIN 条件，语义不变）
--   2. 增加 LEFT JOIN persons p ON p.id = rc.person_id AND p.deleted_at IS NULL
--   3. customer_name 改为 COALESCE(c.customer_name, p.display_name)（两侧均 text，类型不变；
--      既有 14 行 COALESCE 第一优先级仍是 customers.customer_name，内容不变）
--   4. 视图保持 security_invoker=true；persons anon 只读复用 PMC-10 migration 20261008231500 授权，无新授权
--   5. CREATE OR REPLACE 保留既有 GRANT，末尾重申 GRANT 幂等兜底
-- 回滚: cloudbase/rollbacks/20261009070000_fix_v_recruit_candidates_left_join.sql

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
