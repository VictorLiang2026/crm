-- Migration: PMC-12 招募域读切换 —— 候选人人物基础字段改以 Person 为权威（Person 优先，customers 副本回退）
-- 日期: 2026-10-09
-- 背景: data-model.md §2.3/§6.2 已批准（阶段 3 读切换）：招募视图身份字段改经 recruit_candidates.person_id
--       读取 persons；列名/列序/类型对外不变（T1 契约）。G-PMC11-2 修复（20261009070000）已完成 LEFT JOIN
--       结构与 customer_name 的 COALESCE（当时 c 优先，副本兜底）；本迁移把 Person 提为第一优先级。
-- 变更（列名/列序/类型全部不变，39 列 / 12 列）:
--   v_recruit_candidates:
--     customer_name: COALESCE(c.customer_name, p.display_name) → COALESCE(p.display_name, c.customer_name)
--     gender/birthday/phone/occupation/education: c.x → COALESCE(p.x, c.x)
--     wx_account: c.wx_account → COALESCE(p.wechat, c.wx_account)（异名映射）
--     annual_income/mbti/source/marital_status/hobbies/additional_info 保持 customers（客户域权威，D3/D4/来源三义裁决）
--   v_recruit_candidates_trash: customer_name/phone/occupation 同规则切换
--   JOIN 结构保持 G-PMC11-2 形态（LEFT JOIN customers + LEFT JOIN persons）；security_invoker=true 不变；
--   无新授权（persons anon 只读复用 PMC-10 migration 20261008231500）。
-- 数据影响: 已映射候选人的基础字段显示值改为以 Person 为准（PMC-11 实测双源姓名冲突 0；已知单边差异
--   Person 783/客户 788 occupation 按设计以 Person 为准）。独立候选人（customer_id 为空）基础字段从 Person 取值，
--   修复其电话/职业等为空的展示缺陷。customers/persons 两表数据零修改。
-- 回滚: cloudbase/rollbacks/20261009091200_pmc12_recruit_view_person_read.sql（恢复 c 优先定义）

BEGIN;

CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    COALESCE(p.display_name, c.customer_name) AS customer_name,
    COALESCE(p.gender, c.gender) AS gender,
    COALESCE(p.birthday, c.birthday) AS birthday,
    COALESCE(p.phone, c.phone) AS phone,
    COALESCE(p.wechat, c.wx_account) AS wx_account,
    COALESCE(p.occupation, c.occupation) AS occupation,
    c.annual_income,
    COALESCE(p.education, c.education) AS education,
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

COMMENT ON VIEW public.v_recruit_candidates IS '增员候选人完整视图（人物基础字段以 Person 为权威、customers 副本回退；LEFT JOIN 含独立候选人；PMC-12 读切换 2026-10-09）';

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,
    rc.customer_id,
    COALESCE(p.display_name, c.customer_name) AS customer_name,
    COALESCE(p.phone, c.phone) AS phone,
    COALESCE(p.occupation, c.occupation) AS occupation,
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

COMMENT ON VIEW public.v_recruit_candidates_trash IS '增员回收站视图（人物基础字段以 Person 为权威、customers 副本回退；customer_deleted_at 用于"随客户删除"标识；PMC-12 读切换 2026-10-09）';

GRANT SELECT ON public.v_recruit_candidates TO anon, authenticated, service_role;
GRANT SELECT ON public.v_recruit_candidates_trash TO anon, authenticated, service_role;

COMMIT;
