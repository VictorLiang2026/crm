# 2026-10-28 Knowledge attachment release

## Scope

- Added private CloudBase PG Storage bucket `knowledge`, capped at 100,000,000 bytes, with PDF, Office Open XML, text, CSV, PNG, JPEG and WebP MIME allowlist.
- Added per-authenticated-user object path policies and a service-role-only OCR metadata RPC. Business metadata remains in `public.knowledge_sources`.
- Knowledge upload now stores the original object in CloudBase Storage and keeps only metadata/path in PostgreSQL. The legacy Base64 upload route remains capped at 6 MiB.
- Removed the source-URL prerequisite for an attached industry/legal source, fixing `SOURCE_METADATA_REQUIRED` for that upload path. Manual knowledge entry retains its existing URL checks.
- Image OCR obtains a short-lived private object URL server-side; file bytes are not passed through Cloud Function invocation payloads.

## Files and database

- Migration: `20261028150000_knowledge_private_storage.sql`
- Rollback: `20261028150000_knowledge_private_storage.rollback.sql`
- Mirrored migration and rollback in `C:\Users\victor\cloudbase\migrations` (SHA-256 matched).
- `public.knowledge_sources` file-size constraint is 100,000,000 bytes. The rollback refuses to run while new-bucket objects or oversized/new-format sources remain.

## Deployment and verification

- Deployed Cloud Functions: `assistant`, `ai_parse`, `person_360`.
- Uploaded Console modules: `app.js`, `knowledge-pages.js`, `i18n.js`.
- Cloud source verification: 29 functions / 220 source and config files matched; 90 reachable static assets matched.
- Knowledge Library tests: 22 passed. Full regression: 108 passed, 5 historical skips. WP01 release gate: `PASS_WITH_LIMITATIONS`; anonymous checks 77/77 passed.
- Read-only public security catalog: 1,159 checks passed after adding the new service-role-only routine to the expected baseline.
- Live function probes: OCR rejects an invalid source as expected; assistant management invocation rejects unauthenticated callers; Person 360 rejects the unauthenticated probe.

## Known limits and unverified behavior

- Storage accepts files up to 100 MB. This does not mean every 100 MB file can be synchronously analyzed: the current PDF text parser is intentionally capped at 6 MiB; extracted text is capped at 100,000 characters. Larger PDFs need a separate bounded/async document-processing path.
- A real authenticated browser upload, OCR model call, summary generation and resulting knowledge record were not exercised in production. WP01 login evidence was expired; live writes and service-runtime probes remain unverified.
- Rollback is a recovery option only after confirming no new-format source/object remains; it was not executed.

## Follow-up: optional source URL validation fix (2026-10-28)

- Reported symptom: “上传或提取未完成，请检查资料和必填信息后重试。” despite all visible required fields being complete.
- Cause: the save path still rejected `industry_development` and `legal_tax` entries without an external source URL, while the form treats that field as optional. This returned `SOURCE_METADATA_REQUIRED` before the attachment/OCR flow could complete.
- Fix: removed only the hidden URL prerequisite. If a source URL is supplied, the existing HTTPS validation remains; publication date validation remains unchanged.
- Verification before deployment: Knowledge Library 23/23 passed; full regression 108 passed, 5 historical skips; WP01 release gate `PASS_WITH_LIMITATIONS` with no blockers. Live read-only login/permissions probe passed.
- Deployment: `assistant` deployed successfully after the release gate passed. A live read-only invocation reached the function and returned the expected `UNAUTHORIZED` response before knowledge processing, confirming the function is callable without creating data.
- End-to-end save using an authenticated session remains unverified; no production knowledge record or AI summary was created during validation.
- Release: commit `0e5d655`, tag `release-20261028-083120`; local, GitHub `master`, and CloudBase source checks matched.

## Follow-up: PDF extraction retry failure (2026-10-28)

- Reported symptom: a PDF source uploaded successfully but extraction failed; clicking “重试提取” returned `KNOWLEDGE_LIBRARY_FAILED`.
- Diagnosis: assistant delegated PDF parsing to `person_360`. The source object was private CloudBase PG Storage and no `knowledge_source_extract` task had been created, so failure was before AI task creation. The old Node SDK storage download path failed and both functions hid the useful cause behind generic errors.
- Fix: `person_360` now uses the authenticated server-side CloudBase object endpoint for private `knowledge` objects, checks the object owner path and `knowledge_sources.created_by` against the authenticated caller, and returns bounded safe PDF error codes. Assistant passes its authenticated actor to this route and preserves the allowlisted safe codes. Legacy `pg-private://` Base64 source support is retained.
- Verification: PDF-specific tests 6/6; knowledge-library tests 29/29; full regression 108 passed, 5 historical skips; security tests 5/5; shared copies 58/58 matched. WP01 release gate `PASS_WITH_LIMITATIONS`, 1,162 catalog checks, anonymous checks 77/77, fresh read-only login/permission probe passed. Open declared limitations remain service-runtime, production writes/AI, and real mobile acceptance.
- Deployment: `assistant` and `person_360` deployed successfully after their WP01 gates passed. Post-deployment CloudBase source check matched 29 functions / 221 source and config files; all 90 reachable page/module/style assets matched. No production knowledge source was retried or modified during validation.
- Live PDF extraction using the affected authenticated source was not run, to avoid creating/updating a real knowledge draft or AI task. The user can retry the source in the application; if it fails, the UI should now show the safe underlying PDF error code.
- Release tag: `release-20261028-095808`; the published commit is recorded in Git.
# 2026-10-28 知识库附件与 PDF 故障跟进

## 本轮范围

- 修复“上传 PDF 后不生成摘要 / 重试提取返回 UNAUTHORIZED”：`assistant` 在已校验来源归属后直接读取私有附件并在本函数内解析 PDF，不再由 `assistant` 调用 `person_360` 的内部函数入口。保留私有桶、来源归属、软删除和原有调用接口。
- PDF 同步文本提取上限从 6 MiB 提高到 16 MiB，覆盖当前约 9.4 MB 的附件；解析使用独立 Node 子进程、20 秒超时、96 MiB 子进程内存上限、最多 20 页和 100,000 字符。
- 为“删除”失败增加只记录表名、HTTP 方法/状态和安全格式数据库错误码的日志；保留原软删除语义。不记录响应正文、请求体、记录标识或标题。
- 不变更数据库结构、权限、对象存储权限，也不对线上资料执行重试、删除或其他写操作。

## 基线及影响

- 改动范围：`cloudfunctions/assistant` 与知识库专项回归；仅部署 `assistant` 云函数，不改页面、`person_360`、数据库或其他函数。
- 保持现有 API、私有存储、归属校验及回收站恢复流程。过大的 PDF 可继续上传，但超过 16 MiB 时当前同步解析会安全返回大小限制错误；异步大文件解析不属于本轮。
- 根因证据：线上日志显示重试在进入 `person_360` 内部业务路由之前被函数调用身份校验拒绝；现有同步 PDF 解析/worker 上限是 6 MiB；删除失败仅能确认数据库 HTTP 请求失败，原日志没有数据库错误码，暂不推断具体约束原因。

## 回归结果

- `npm run test:knowledge-library`：33/33 通过。包含 9.4 MB PDF 真正解析、16 MiB 边界、重试归属过滤、私有附件路径校验及软删除安全诊断。
- `npm test`：108 项通过、5 项历史跳过；`npm run test:security`：5/5 通过；`npm run check:shared`：29 个函数的 58 份共享副本一致。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`，1,162 项 public catalog 检查、77/77 匿名权限探针、隔离登录、47 项 authenticated HEAD 检查和只读函数探针通过；无发布阻断项。服务角色运行时写入、生产业务写入/AI、真实移动端验收仍未验证。
- 部署后云端核对：29 个云函数、224 个源码/配置文件及 90 个可达页面资源一致。
- 未对生产资料执行提取重试/删除；删除的根因需根据部署后的安全日志与用户下一次手动操作确认，再决定是否需要单独修复。

## 发布及回滚

- 发布前基线：`0fc600a593bfea2e81d4c9f652e9684c41f341a8`，标签 `release-20261028-095808`。
- 部署：仅 `assistant` 云函数；上传成功，云端源码核对通过。
- Git 提交/标签：发布完成后补录。
- 回滚：依据发布前标签恢复 `assistant` 函数代码并形成正常恢复提交；不回滚或改变任何数据库/对象存储数据。

## 已知限制

- PDF 同步解析限制为 16 MiB、20 页及 100,000 字符；更大的文件需要异步解析路径。
- 删除操作的数据库错误尚未从生产重试日志确认，本轮只加安全诊断日志；部署后需由用户手动重试一次再根据安全错误码定位。
- `npm audit --omit=dev` 报告 2 个高危传递依赖项来自本轮前已有的 `@cloudbase/node-sdk@4.1.0` / `axios@0.27.2` 链路。本轮未升级 SDK，避免扩大修改范围。
