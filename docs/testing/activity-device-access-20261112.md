# 活动详情设备授权委托修复（2026-11-12）

## 根因

活动详情“流程”加载活动花名册事实时，`activities` 已完成设备签名校验，并向 `person_360` 发起内部委托。线上签名来源为 `activities`，但 `person_360.issueInternalDelegation` 将外层调用事件限定为恰好 `action,attestation,payload` 三个字段。CloudBase 内部调用附带额外的外层事件字段，导致合法请求在 payload 策略和数据库委托前被拒绝为 `DEVICE_ACCESS_DENIED`。

## 修复范围与兼容

- 仅在 `person_360/device-runtime.js` 的内部委托入口忽略未使用的外层传输元数据；必须存在 `action`、已签名 `attestation` 和 `payload`，且 `action` 必须精确匹配。
- 继续拒绝 `__crmDelegation`、`__deviceRequest`、原型污染相关字段。
- 保持签名有效期/来源/设备指纹、各来源 payload 精确白名单、数据库 `service_role` 检查及一次性委托 token 校验不变。
- 不修改业务数据、数据库对象/权限、活动页面或其他云函数。仅部署 `person_360`。
- `tests/regression/smoke.cjs` 将既有 AI 路由浏览器断言等待时间从 6 秒调整为 15 秒；URL、hash、DOM 断言不变。
- WP04 只读审计明确支持正式花名册 `person_type=attendee`，要求有效 roster 关系及 canonical Person 一致，不写数据库。

## 验证

- `tests/security/device-delegation.test.cjs`：8/8 通过；新增外层传输元数据兼容与保留安全字段拒绝用例。
- 完整 WP01：`PASS_WITH_LIMITATIONS`；只读 public catalog 1518 项检查通过，WP04 覆盖客户 785/785、参与者 3/3、增员 573/573、嘉宾 6/6，0 异常；匿名探针 104/104 通过；隔离回归 104 通过、0 失败、5 项预设跳过。
- WP01 未覆盖的真实登录、service-role 写探测、生产 CRUD/AI 写入和移动端验证仍为未验证；本轮未执行生产写入。
- 线上 `person_360` 函数上传成功并恢复 `Active`；最终下载的 `device-runtime.js` 与 `index.js` 均与本地 SHA-256 一致。
- 最终版本活动详情真实浏览器点击验收：待用户确认结果。

## 发布与恢复

- 改前本地/GitHub 基线：`ff3a0dc323584a8d0866415a5f3b61e94190a2e1`，发布标签 `release-20261112-114216`。
- 云端只上传 `person_360`；静态页面与其他函数不在本轮部署范围。
- 本轮 Git 提交、推送、标签及发布后完整三端一致性核对尚待完成。
- 若需恢复，仅恢复 `person_360/device-runtime.js` 到本轮前版本并重新部署 `person_360`；无数据库回滚或数据删除。
