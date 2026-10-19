# 招募目录表格、搜索与分页（2026-10-18）

## Scope

- 将 console 招募目录的候选人卡片改为人物目录风格的可排序表格。
- 表头：姓名、招募阶段、招募优先级、潜力评分、下次跟进日期、阶段停留天数、最近更新日期、编号；各列均支持排序。
- 添加姓名搜索、招募阶段和招募优先级多选筛选；搜索/筛选组合后回到第 1 页。
- 每页显示 30 条并支持前后翻页；收窄八阶段漏斗/月度目标侧栏。
- 只改既有 public 视图的读取参数，不改数据库结构、权限、写入、删除或恢复流程。

## Compatibility

- 新页面仍经既有 `person_360:listRecruitDirectory` 入口读取数据。
- 不带新筛选/排序参数的旧游标请求保留原行为；目录新参数只影响读返回结果。
- 保留 legacy 与 Person-only 招募候选人的合并、人物档案跳转及既有 1,000 条结果上限。
- 招募创建、候选人档案、八阶段漏斗、月度目标和回收站流程不改。
- 中英文新界面文案放在 `crm/js/modules/console/i18n.js`。

## Changed artifacts

- `crm/js/modules/console/pages/recruit.js`
- `crm/css/console.css`
- `crm/js/modules/console/i18n.js`
- `cloudfunctions/person_360/recruit-directory-service.js`
- `tests/pc31/recruit-directory.test.cjs`
- `tests/console/recruit-directory.browser.cjs`
- `package.json`

## Verification

- `npm run test:pc31`: 10 passed, including browser behavior, all eight sortable columns, combined multi-select filters, and 30-row paging.
- `npm run test:people-pages`: 5 passed; `npm run test:pc19`: 10 passed; `npm run test:pc21`: 24 passed; `npm run test:pc28`: 21 passed; `npm run test:modular`: passed.
- `npm run test:wp01`: release gate `PASS_WITH_LIMITATIONS`; catalog 1,031 checks passed, anonymous checks 71/71 passed, regression 108 passed / 0 failed / 5 skipped, WP04 audit passed with 3 documented exceptions. Manual login, service runtime, live writes, and real mobile acceptance remain explicitly unverified.
- Local browser test covers desktop, iPad width, and horizontal table scrolling at phone width. No production mobile visual acceptance was performed.
- Production function invocation was attempted read-only after deployment. CloudBase CLI invoked `person_360` but returned `UNAUTHORIZED` because the invocation had no CRM end-user identity; successful authenticated production list loading remains unverified.

## Release

- Initial release: commit `e916e4d`, tag `release-20261018-2231`; includes the user-approved existing PC28 commit `6abbc2a`.
- Initial cloud deployment scope: `crm/css/console.css`, `crm/js/modules/console/i18n.js`, `crm/js/modules/console/pages/recruit.js`, `crm/js/modules/console/recruit-delete.js`, and functions `assistant` (PC28) / `person_360` (directory filters and sorting). No database or permission changes.

## Follow-up fix: route action validation

- Diagnosis: the console API adapter includes `action: "listRecruitDirectory"` in the RPC event. `person_360` dispatches the event unchanged to this service, but the filtered-criteria allowlist rejected the normal `action` field, producing `Invalid recruit directory criteria` on production.
- Fix: accept only `action: "listRecruitDirectory"` in the criteria envelope while continuing to reject unknown fields and other action values.
- Regression: `npm run test:pc31` passed 10/10, including a production-shaped RPC envelope and rejection of an unrelated action. WP01 passed with its existing declared limitations and 3 registered identity exceptions.
- Function `person_360` was redeployed. CLI smoke invocation reached the deployed function but returned `UNAUTHORIZED` because the invocation had no authenticated CRM user; the service-level and browser-harness regressions cover the valid envelope, while authenticated production invocation remains unverified.
- Follow-up fix release: `release-20261018-2305` (published from the latest GitHub master after cloud parity verification).

## Follow-up fix: tolerate RPC transport context

- The production log after `release-20261018-2305` still showed `Invalid recruit directory criteria` for authenticated list calls. The dispatched action was valid; the remaining rejection came from checking the entire CloudBase event for unknown keys.
- Updated criteria validation to read only the supported action, pagination, search, stage, priority, and sorting fields. Extra transport context is ignored and never forwarded to PostgREST; supported filter values and sort fields remain validated against fixed allowlists.
- Regression: `npm run test:pc31` passed 11/11, including a production-shaped request with extra transport context, and retained rejection tests for an unsupported sort field, invalid stage, and unrelated action.
- `person_360` was deployed. CloudBase logs from 2026-10-18 23:35 through 2026-10-19 00:00 showed no further `Invalid recruit directory criteria` responses. An authenticated list request from the browser could not be independently exercised in this session.
- The user approved publishing the already-deployed recruit service change and regression. The recruit directory fix was included with PC36 in commit `7caaa76f464258a7c7088ddcc699d71915efdecd`, tag `release-20261019-011137`; post-release parity passed at that time.
- Later, release parity found production-only changes in `cloudfunctions/pmc18_observer/index.js`. The user authorized syncing that source with no PM18 redeployment. It was subsequently superseded by the separately approved PC36 bounded collection implementation, which is already on `master` and production; this round must preserve the newer PC36 implementation.
- Release parity found production-only changes in `cloudfunctions/pmc18_observer/index.js`. The user authorized syncing the current production source into Git, with no PM18 redeployment. The verified production SHA-256 is `9602D0E53FEC2BB57546059C0160A24F6A3F194EA6A90DE430318135407D2F3D`; this version calls the existing `public.pmc18_collect_once_v1()` RPC.
- The user separately authorized recording the existing live RPC as `cloudbase/migrations/20261019090000_pmc18_collect_once_v1.sql` with rollback at `cloudbase/rollbacks/20261019090000_pmc18_collect_once_v1.rollback.sql`. Its definition was read from `public` only. These files document the live object and recovery path; neither migration nor rollback was executed, and the function will not be redeployed in this release. The rollback requires reverting the existing PM18 caller first.
- A fresh public-only WP01 catalog found `pmc18_collect_once_v1()` missing from `tests/security/expected-public-baseline.json`. Live metadata shows `SECURITY DEFINER`, `anon_execute=true`, `authenticated_execute=false`, and `service_execute=false`; the ACL grants anon plus the function owner. The routine can collect aggregate metrics and write 20 observation rows. The user authorized recording this existing permission state in the repository baseline. No permission or database change was made.

## PM18 permission compatibility check (2026-10-19)

- The user authorized preparing and validating a `service_role`-only permission repair. A paired migration/rollback was prepared and `planMigration` passed. Before applying it, the public-only catalog showed that today's 20 observation rows were complete, so the PM18 collector's existing idempotent path could validate without inserting rows.
- Migration `20261019020500_pmc_rpc_service_role` briefly changed the routine ACL to `service_role` only. The actual `pmc18_observer` invocation failed with `permission denied for function pmc18_collect_once_v1`; this proves the live Cloud Function RDB caller uses the `anon` permission path. No observation rows were added during the failed call.
- Migration `20261019021100_pmc_rpc_anon_compat` restored the observed `anon`-only execution ACL. The PM18 function was then invoked through the authorized CloudBase CLI and returned `{ok:true,reused:true,metrics:20}` for the existing snapshot. Catalog verification shows `anon_execute=true`, `authenticated_execute=false`, `service_execute=false`; migration history records both permission migrations.
- The permission change therefore cannot be retained without breaking PM18. Its original ACL and live behavior are restored. The WP01 guard initially required `service_execute=true` for every routine, so this exact RPC needed an explicitly reviewed compatibility exception before the gate could progress.
- After the user approved a single exact routine exception, WP01 records the observed ACL and invocation evidence; all other routines remain service_role-only in the gate. The `person360.family` browser timeout seen in the first WP01 run did not reproduce in the isolated check or the later full regression.
- A fresh anonymous gateway probe found that `public.pmc18_observations` has an anon SELECT grant and `pmc18_obs_read` policy. The user approved a separate exact probe exception limited to status and row count, preserving the existing ACL and PM18 behavior.

## Approved aggregate-only probe exception (2026-10-19)

- The user approved one exact anonymous gateway probe exception for `public.pmc18_observations`, limited to HTTP status and total row count; the probe must not fetch or store row content. The permission and `pmc18_observer` behavior remain unchanged.
- `tests/security/gateway-probe.cjs` now uses HEAD only for that table and accepts only HTTP 206 plus a positive count divisible by 20, matching complete collector snapshots. The ignored report stores only the count; an unexpected status/count format fails closed. No GET was sent.
- `npm run test:security`: 5/5 passed. `npm run test:security:gateway -- --output tests/security/.results/gateway.json`: 71/71 passed; the approved probe reported status 206 and count 20. `git diff --check` passed.
- After fast-forwarding the isolated release worktree to the latest GitHub master (which already includes the separately published PC36 work), the exact table exception was retained and the duplicate routine catalog row from the two baselines was removed. `npm run test:security` passed 5/5; `npm run test:security:gateway` passed 71/71. `npm run test:pc31` passed 11/11; `npm run test:pc28` passed 21/21.
- Fresh `npm run test:wp01`: `PASS_WITH_LIMITATIONS`, 1,036 catalog checks passed, anonymous 71/71, regression 108 passed / 0 failed / 5 historical skips, WP04 `PASS_WITH_EXCEPTIONS` with 3 declared identity exceptions. Manual login, service-role runtime, live writes, and real mobile visual acceptance remain unverified.
- Cloud-only parity passed after integrating the concurrent master updates: online `admin.html` matched, 75 reachable frontend assets matched, and all 29 functions / 201 source and configuration files matched. No cloud artifact needs redeployment in this Git-only release. The release script will repeat the cloud check before and after push; GitHub publication is pending.
