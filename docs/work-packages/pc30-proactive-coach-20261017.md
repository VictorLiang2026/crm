# PC30 Proactive Coach release record

Date: 2026-10-17 (Asia/Shanghai)

## Scope

- Added deterministic, bounded Today candidates for due commitments, recently changed relationship records, post-activity follow-up gaps, stagnant recruit records, and evidence-backed relationship cadence decay.
- Candidates show their source and observation window. Missing or insufficient evidence does not create a signal. Deleted Persons, completed follow-up, and existing open Actions suppress duplicate reminders.
- Added per-operator defer/reject state. Deferrals reappear after expiry with the prior decision visible. Decisions retain source references only; source facts remain live.
- Action creation stays behind the existing server WorkItem preview and explicit human confirmation. Test or unverified provenance disables Action creation.
- Preserved existing Today, Morning Brief, Relationship Decay, admin.html, and WorkItem flows. No external contact or relationship-strength update was added.

## Database

- Applied `20261017232000_proactive_coach` to `public` in production CloudBase `crm-d1gkae8ddc930d151`.
- Added `public.crm_proactive_coach_decisions` and `public.crm_proactive_coach_decision_v1(...)`; paired rollback is `cloudbase/rollbacks/20261017232000_proactive_coach.sql` and refuses to discard any saved decision rows.
- Post-migration metadata showed 0 decision rows, RLS enabled and forced, only `service_role` policy access, no anon/authenticated table privileges, and service-only RPC execution. The function is not SECURITY DEFINER and pins `search_path=pg_catalog, public`.
- No business sample rows were inserted. No `pr` schema/object/function was accessed.

## Release artifacts

- Function: `person_360` deployed after shared-file hash verification.
- Static files uploaded individually under `/crm/js/modules/console/`: `data.js`, `i18n.js`, `pages/today.js`, `proactive-coach.js`.
- Each uploaded asset returned HTTP 200 and matched its local SHA-256.
- Full CloudOnly sync check passed: 29 CRM functions / 197 source and config files, 73 reachable page/module/style assets, and `admin.html` all matched the deployed source.
- Release tag: `release-20261017-224137`.

## Verification

- PC30: 10/10 fictional migration-contract, service, decision persistence, source-failure, provenance, bilingual iPad browser, preview, and confirmation checks passed.
- Adjacent suites passed: PC08, PC09, PC10, PC18, PC20, PC21, PC26, PC27, and PC29.
- WP01 release gate: `PASS_WITH_LIMITATIONS`; 108 isolated legacy regression checks passed, 5 pre-existing checks were skipped, anonymous public checks passed 69/69, and public catalog comparison passed 995 checks. WP04 audit remains `PASS_WITH_EXCEPTIONS` for its 3 already documented participant identity exceptions.
- `npm run test:modular`, `npm run check:shared`, JS syntax checks, and `git diff --check` passed.

## Limits and recovery

- CloudBase `manageFunctions(invokeFunction)` could not run because its management call returned `Cam authentication failed`; the CLI invocation path also rejected the JSON argument before reaching the function. The function therefore has successful deployment and source-sync evidence, but no live authenticated runtime probe in this package.
- No production business write, real-user login, service-role write probe, external contact, or mobile-device test was run. WP01 records these as `MANUAL_LOGIN` / `UNVERIFIED`, not as passes.
- Before using the paired rollback after operators have saved decisions, export and review those rows; rollback intentionally refuses while the table is populated.
- No live business records or function source should be rolled back for this package. Page source and function deployment can be restored from the previous release tag if a follow-up finds a runtime defect; any database reversal requires separate data review.
