-- PMC-17 指令④ rollback: 撤销 customers <-> persons 关联回填。
-- 对称逆操作，恢复 migration 前状态：
--   - Person 790/791/792 保留（person_identity_execute_v1 产物，不在本 migration 范围）；
--   - 派生 customer 角色由 PMC-15 触发器随 person_id 置 NULL 自动清除；
--   - C 逆后桥触发器会把恢复值推回 persons.783，须补写 persons.occupation=NULL
--     以精确复原 migration 前漂移状态（customers 有值 / persons NULL，PMC-04 登记项）。
-- 执行通道: 单条 DO 块（原子，tcb db execute 单语句通道）。
DO $pmc17rb$
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','60s',true);

  -- C 逆: customer 788 occupation 恢复原值（桥会推 persons.783，下一句修正）
  UPDATE public.customers SET occupation='【系统测试·勿联系】虚构资料验收职业', updated_at=now()
    WHERE "Id"=788 AND occupation IS NULL AND person_id=783 AND deleted_at IS NULL;
  UPDATE public.persons SET occupation=NULL, updated_at=now()
    WHERE id=783 AND occupation='【系统测试·勿联系】虚构资料验收职业'
      AND legacy_customer_id=788 AND deleted_at IS NULL;

  -- B 逆: 软删 customer 776 解除关联
  UPDATE public.customers SET person_id=NULL
    WHERE "Id"=776 AND person_id=768 AND deleted_at IS NOT NULL;

  -- A1 逆: customer 786 / person 790
  UPDATE public.customers SET person_id=NULL, updated_at=now()
    WHERE "Id"=786 AND person_id=790 AND deleted_at IS NULL;
  UPDATE public.persons SET gender=NULL, legacy_customer_id=NULL, updated_at=now()
    WHERE id=790 AND legacy_customer_id=786 AND deleted_at IS NULL;

  -- A2 逆: customer 789 / person 791
  UPDATE public.customers SET person_id=NULL, updated_at=now()
    WHERE "Id"=789 AND person_id=791 AND deleted_at IS NULL;
  UPDATE public.persons SET gender=NULL, legacy_customer_id=NULL, updated_at=now()
    WHERE id=791 AND legacy_customer_id=789 AND deleted_at IS NULL;

  -- A3 逆: customer 790 / person 792
  UPDATE public.customers SET person_id=NULL, updated_at=now()
    WHERE "Id"=790 AND person_id=792 AND deleted_at IS NULL;
  UPDATE public.persons SET legacy_customer_id=NULL, updated_at=now()
    WHERE id=792 AND legacy_customer_id=790 AND deleted_at IS NULL;
END $pmc17rb$;
