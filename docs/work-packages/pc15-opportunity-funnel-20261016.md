# PC15 — Opportunity archive and funnel alignment

Date: 2026-10-16  
Base: PC14 release `14661938aa63132755d6cb57526bc358cd15ba21`  
Scope: Person opportunity directory, status history, server-side filters/paging, detail and Action/Outcome history, separate Person-only and legacy funnel measures.

## Behavior and compatibility

- Person-only opportunities (`customer_id IS NULL`) support edit, stage change, won/close through the existing server preview, human confirmation, and execute workflow.
- Legacy customer opportunities remain discoverable and read-only in this directory. Their existing customer workflow and `opportunities` function are preserved; the detail panel links back to the legacy customer area.
- The terminal view contains both won and closed records. Details show current fields, linked Actions, and Outcomes.
- Person-only status counts and the legacy `v_funnel_stats` opportunity funnel are displayed separately with their source and denominator definitions. Selecting a count filters the matching source records. No conversion percentage is introduced.
- AI candidate promotion remains a separate, reviewed flow. No historical rows are migrated or renamed and no existing view is replaced.

## Data and migration

- Added `public.crm_opportunity_directory_v1`, a service-role-only read RPC for filtered directory rows, status counts, and server pagination. It joins legacy customer records to Person names through `customers.person_id`; directory and detail reads preserve the existing opportunity visibility for all signed-in actors. Existing write-preview fictional-data guards remain in place.
- Migration: `20261016123000_opportunity_directory.sql`; paired rollback: `.rollback.sql`.
- Migration plan was executable and the apply task completed with `Status=Succeed`; the remote migration history verified version `20261016123000`.
- Compatibility correction: migration `20261016130000_opportunity_directory_read_scope.sql` removes the test-record read restriction introduced by the first version; paired rollback restores that prior function body. Both replacement and rollback reload the PostgREST schema. Apply task `task-4c694934d022420f` completed with `Status=Succeed`.
- No rows were inserted, updated, or deleted; no existing table, view, route, or function was removed or renamed.

## Changed assets

- `cloudfunctions/person_360/index.js`, `cloudfunctions/person_360/opportunity-workflow-service.js`
- `crm/js/modules/console/pages/opportunities.js`, `crm/js/modules/console/data.js`, `crm/js/modules/console/write.js`, `crm/js/modules/console/i18n.js`, `crm/css/console.css`
- `cloudbase/migrations/20261016123000_opportunity_directory.sql` and rollback
- `tests/pc15/`, `package.json`

## Verification and release

Pre-deployment checks on 2026-10-16:

- `npm run test:pc15`: 5/5 passed, including browser coverage for filters, paging, terminal history, details, preview-before-execute, bilingual iPad layout.
- Neighbor regressions: `test:pc12` 9/9, `test:pc13` 4/4, `test:pc14` 7/7, `test:pc04` 8/8, `test:wp06` 5/5, `test:people-pages` 4/4, Today 16/16, opportunity workflow 8/8.
- `npm run test:wp01`: 108 PASS, 0 FAIL, 5 SKIP; gate `PASS_WITH_LIMITATIONS`. Catalog checked 907 assertions over 53 tables, 12 views, 37 sequences, and 49 routines. Anonymous gateway probe: 65/65 PASS. Login, service-runtime and production write flows remain unverified; these are documented limitations rather than claimed passes.
- `npm run test:security`: 4/4 passed. Fresh production `public` catalog snapshot: 904 checks, 0 failures; new RPC is executable only by `service_role`.
- `npm run test:modular`, `npm run check:shared`, and `npm run check:release-gate` passed. `git diff --check` passed.
- No business rows or test seeds were written. PC15 isolated browser and service regressions use fictional fixtures.

Deployment: `person_360` uploaded successfully; five static files uploaded individually (`console.css`, `data.js`, `i18n.js`, `pages/opportunities.js`, `write.js`). `admin.html` was unchanged.

- Post-deploy CloudOnly sync check passed: admin page hash matched; 59 reachable static assets matched; all 29 CRM functions / 184 source and config files matched local. GitHub/source release sync follows in tag `release-20261016-120700`.

## Rollback

1. Roll back the static files and `person_360` function to the preceding published tag.
2. After confirming no deployed client/function still calls `public.crm_opportunity_directory_v1`, apply migration rollbacks in reverse order: `20261016130000` restores the preceding function body; `20261016124500` refreshes the REST schema cache; `20261016123000` drops the new function.
3. Do not modify existing opportunity records or the legacy funnel view during recovery.

## Remaining verification gaps

- No real business row is modified for PC15 regression. Live signed-in user interaction requires the account session and must be verified in the CRM UI.
