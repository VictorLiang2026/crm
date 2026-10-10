-- PMC-17 指令④: customers <-> persons 关联回填（数据完整化，D2 执行结果固化）。
-- 前置: person_identity_execute_v1 已建 Person 790(刘飞（北大）)/791(A测试)/792(ABC)
--   （actor=pmc17-d2-operator，2026-10-10，命令记录见 person_identity_commands；
--    786 与既有活跃 Person 754「刘飞（活动行）」同名不同人，限定词区分，用户已确认）。
-- 内容:
--   A1-A3: 新 Person 补 gender（execute 不写 gender，从 customers 复制防漂移）+
--          persons.legacy_customer_id 与 customers.person_id 双向关联。
--   B: 软删客户 776 <-> 软删 Person 768 一对一关联（软删时间戳一致 2026-09-05 03:40:08.02）。
--   C: customer 788 occupation 投影对齐（PMC-04 登记漂移，persons 赢：783.occupation=NULL
--      -> customers.788.occupation=NULL；桥触发器同步 persons.updated_at，值不变）。
-- 影响: customers 786/789/790/776/788 五行；persons 790/791/792 三行；
--       PMC-15 派生触发器将为 790/791/792 补 origin=derived 的 customer 角色。
-- 执行通道: 单条 DO 块（原子；cloudbase-mcp 认证过期，经 tcb db execute 单语句通道应用，
--   与 PMC-14 生产 UPDATE 同通道）。守卫失败即 RAISE，整个 DO 块回滚。
-- public schema only. 配对 rollback:
--   cloudbase/rollbacks/20261010091000_pmc17_customers_person_link_backfill.rollback.sql
DO $pmc17$
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','60s',true);

  -- A1: customer 786「刘飞（北大）」 <-> person 790
  UPDATE public.persons SET gender='男', legacy_customer_id=786, updated_at=now()
    WHERE id=790 AND display_name='刘飞（北大）' AND gender IS NULL
      AND legacy_customer_id IS NULL AND deleted_at IS NULL;
  UPDATE public.customers SET person_id=790, updated_at=now()
    WHERE "Id"=786 AND customer_name='刘飞（北大）' AND person_id IS NULL AND deleted_at IS NULL;

  -- A2: customer 789「A测试」 <-> person 791
  UPDATE public.persons SET gender='男', legacy_customer_id=789, updated_at=now()
    WHERE id=791 AND display_name='A测试' AND gender IS NULL
      AND legacy_customer_id IS NULL AND deleted_at IS NULL;
  UPDATE public.customers SET person_id=791, updated_at=now()
    WHERE "Id"=789 AND customer_name='A测试' AND person_id IS NULL AND deleted_at IS NULL;

  -- A3: customer 790「ABC」 <-> person 792（无基础字段需补）
  UPDATE public.persons SET legacy_customer_id=790, updated_at=now()
    WHERE id=792 AND display_name='ABC' AND legacy_customer_id IS NULL AND deleted_at IS NULL;
  UPDATE public.customers SET person_id=792, updated_at=now()
    WHERE "Id"=790 AND customer_name='ABC' AND person_id IS NULL AND deleted_at IS NULL;

  -- B: 软删 customer 776「回收站测试勿动」 <-> 软删 person 768（纯关联，不动 updated_at）
  UPDATE public.customers SET person_id=768
    WHERE "Id"=776 AND customer_name='回收站测试勿动' AND person_id IS NULL AND deleted_at IS NOT NULL;

  -- C: customer 788 occupation 投影对齐 persons(783)=NULL（persons 赢）
  UPDATE public.customers SET occupation=NULL, updated_at=now()
    WHERE "Id"=788 AND occupation='【系统测试·勿联系】虚构资料验收职业' AND deleted_at IS NULL;

  -- 守卫: 全部回填后 customers 全表（含软删）person_id 零 NULL
  IF EXISTS (SELECT 1 FROM public.customers WHERE person_id IS NULL) THEN
    RAISE EXCEPTION 'PMC-17 backfill incomplete: customers with NULL person_id remain';
  END IF;
END $pmc17$;
