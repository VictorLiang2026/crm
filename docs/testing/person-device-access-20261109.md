# Person 访问安全：第一阶段（2026-11-09）
基准 master 211ff1592df9521b446761f8ee3d3fb293a62ea4。发布前核对线上管理页、98 项静态资源及 30 个函数的 245 项源码/配置文件。未改动公开报名开发中的工作区。
## 发现与修复
未登录直接请求 customers、followups 和 person_360 均 401，匿名会话和公开密钥均 403。但此前仅拿公开密钥或匿名会话，直接请求 public.persons 的姓名/电话列，HEAD 显示非零可见行。没有读取实际客户数据；这些结果不能说明是否发生过历史泄露。
两次独立普通测试身份均已停用。使用仅含虚构内容的记录，证实普通账号可以通过 customers.get 和 person_360.get 读到合成姓名，followups.list 也进入业务逻辑。账号验证与设备验证是后续阶段，不能以本轮 RLS 修复代替。
数据库先增加 persons_fn_read，保留 service_role 路径，仅给服务端（已签名 anon 角色且没有 sub）看未删除人物。以独占合成 Person/Customer 和仅对其生效的临时 restrictive 策略模拟切换，实际旧云函数能读出合成姓名，公开密钥读取该行返回 200 */0。再移除旧例外 persons_anon_read；没有修改字段、视图、服务角色或匿名登录开关。
## 验证与边界
- 切换后生产 HEAD：无凭据 401；公开密钥、真实匿名会话 200 */0。测试显式投影 display_name、phone，不读取原文或客户记录。
- 两轮合成数据、派生角色及临时策略均清理；无业务数据迁移。独立 PostgreSQL 运行引擎用合成数据验证当前规则、调用者视图、软删除、匿名/普通/服务角色和两个 rollback。可设置 CRM_PGLITE_MODULE 指向本地 @electric-sql/pglite 后运行 node tests/device-access/persons-rls.cjs。实际网关探针：CRM_PUBLIC_KEY_FILE 指向受保护的本地公开密钥文件，运行 node tests/device-access/person-gateway.cjs。
- 报名草稿的公开展示、合成报名提交、拒绝无效管理令牌均通过本地服务验证；真实报名 migration 与 Person 切换共存时，以 service_role 在隔离库提交成功，匿名不能直读报名表。生产公开报名页为 404，activity_registration 尚未部署，未把线上完整报名记为通过。
- GPT 授权连接用已确认不存在的知识条目返回 CONTENT_NOT_FOUND，而非授权失败。未读取真实资料或写入建议。设备阶段需保留 GPT 的 OAuth 范围和已签名内部通道。
- 软件设备凭据、CloudBase 后台批准、旧会话即时撤销、附件直连封锁尚未上线。knowledge 和 recruit 的授权、签名链接及 public-only 边界需单独核实。浏览器清理站点数据需要重新申请，已经下载的数据无法远程收回。
## 恢复
第一个 rollback 在旧策略已移除时会拒绝删除服务端路径。第二个 rollback 会恢复已知匿名读取风险，只能经事故授权显式开启 crm_security.allow_exposure_rollback；应优先修复受影响服务端调用，不自动重新暴露资料。没有修改页面、Cloud Functions 或存储桶。
