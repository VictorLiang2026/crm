# PMC-07 证据（evidence/PMC-07）

状态：**已发布，待用户验收**。基线：`206801e` / `release-20261008-1945`；实测日期 2026-10-08。

---

## 1. 产物清单

| 文件 | 变更 | 状态 |
| --- | --- | --- |
| `cloudfunctions/person_360/index.js` | 新增 `updatePerson` action | 已部署 |
| `cloudfunctions/customers/index.js` | `update` action 增加 Person 字段映射 | 已部署 |
| `cloudfunctions/ocr_records/index.js` | `remove` 返回增加 `personSnapshot` | 已部署 |

---

## 2. 变更详情

### 2.1 person_360 — `updatePerson` action

**功能**：修改已确认人物的基础资料（persons 表）。

| 项 | 设计 |
| --- | --- |
| 入参 | `{ personId: string, displayName?, phone?, birthday?, gender?, occupation?, organization?, education?, wechat?, notes?, expectedUpdatedAt: string }` |
| 权限 | authenticated 用户 |
| 乐观锁 | `WHERE updated_at = $expectedUpdatedAt` |
| 允许字段 | display_name, phone, birthday, gender, occupation, organization, education, wechat, notes |
| 字段映射 | camelCase → snake_case（displayName→display_name, wxAccount→wechat 等） |
| 返回 | `{ ok: true, updated: true, id, updatedAt }` 或 `{ ok: false, updated: false, conflict: true }` |

**与 resolveName 的区分**：本 action 只接受已知 personId，不凭姓名匹配。

### 2.2 customers — `update` action 增加 Person 映射

**功能**：阶段 2 双写——基础字段变更同步映射到 persons（T2 模式）。

| 项 | 设计 |
| --- | --- |
| 映射字段 | customer_name→display_name, phone→phone, birthday→birthday, gender→gender, occupation→occupation, education→education, wx_account→wechat |
| 触发条件 | 仅当 customers 行有 person_id 且更新包含上述字段时 |
| 方向 | customers→persons（反向写 persons，保持 persons 权威） |
| 兼容性 | 旧前端入参/返回结构不变（C1/C2） |

### 2.3 ocr_records — `remove` 返回增加 `personSnapshot`

**功能**：OCR 恢复前比较当前值、解析后值和快照前值。

| 项 | 设计 |
| --- | --- |
| 返回结构 | `{ ok, customer_snapshot, personSnapshot }` |
| personSnapshot 内容 | `id, display_name, phone, birthday, gender, occupation, organization, education, wechat, updated_at` |
| 用途 | 前端恢复时比较当前 Person 值 vs 快照前值，检测并发冲突 |

---

## 3. 部署记录（2026-10-08）

| 函数 | 部署时间 | 结果 |
| --- | --- | --- |
| `customers` | 2026-10-08 07:58 UTC | ✅ 成功 |
| `ocr_records` | 2026-10-08 07:58 UTC | ✅ 成功 |
| `person_360` | 2026-10-08 08:15 UTC | ✅ 成功（用户授权后） |

---

## 4. 测试

| 测试项 | 状态 | 说明 |
| --- | --- | --- |
| 语法检查 | ✅ | `node -c` 通过 |
| WP01 门槛 | 待执行 | 发布后验证 |
| 旧功能回归 | 待执行 | customers list/get/create/update/remove、OCR 恢复链 |
| 新功能验证 | 待执行 | updatePerson 乐观锁、字段映射、personSnapshot 返回 |

---

## 5. 发布与三端核对（待回填）

**发布命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "PMC-07 Person 统一写入服务：person_360 新增 updatePerson（乐观锁+字段映射）；customers.update 增加 Person 字段映射；ocr_records.remove 返回 personSnapshot"
```

**回填项**：
- 主提交 SHA：____
- 发布标签（时间戳）：`release-____________-____`
- 是否首提交（需 semver）：否
- GitHub push 结果：____
- 云端部署范围：3 个函数（person_360/customers/ocr_records）
- sync-check.ps1 结果：____
- 三端一致性：____
