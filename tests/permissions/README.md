# public 权限验证（进行中）

先运行验证，后评估修复；不以旧静态报告、管理员查询成功或has_table_privilege单独判定用户权限。

环境固定 crm-d1gkae8ddc930d151。通过 CloudBase auth(status) 确认环境后，使用 queryPgDatabase(action=sql, limit=200)逐个执行01—03脚本；检查success与未截断。脚本只读取public对象元数据，不访问pr业务对象。

01记录RLS、owner、reloptions、视图定义、显式ACL与策略；02记录anon/authenticated/service_role有效授权；03为隔离记录验证准备字段事实。

后续闸门：

1. 从public对象定义发现跨schema业务依赖时，停止相关变更，不顺着依赖查询pr。
2. 先根据实测字段设计带唯一 [CRM_PERMISSION_TEST] 标记的隔离记录，记录主键；不使用真实客户记录做写测试。
3. 分别验证管理端、匿名客户端、真实登录客户端和现有云函数的RDB路径。只报告角色及身份存在性，不保存凭据、token或个人身份明文。
4. 未验证云函数兼容之前，不生成或执行权限migration。
5. 如修复改变已有访问行为，先交付事实、影响、兼容与回归方案，获得明确确认后才能编写对应变更。
6. migration必须带精确rollback；不使用CASCADE、不更改非public对象或pr_函数。
