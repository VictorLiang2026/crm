# Knowledge Library management update — 2026-10-27

## Scope

- Replaced the knowledge type selector with one multi-select category field using the 14 requested categories.
- Reworked the Knowledge Library home page into a sortable, searchable list with title-only search by default, optional title-and-summary search, category/status filters, and pagination.
- Added separate upload, new knowledge, new conversation strategy, edit, and recycle-bin pages in the Console module structure. The menu remains between AI Assistant and More; Knowledge Library is no longer duplicated under More.
- Added editable summaries (AI generated when blank), active/inactive state controls, soft delete, restore, and retry for failed source extraction.
- Kept both AI follow-up suggestions: general strategy guidance and company-library-grounded guidance. The user still chooses which recommendation to adopt.
- AI and meeting-preparation reads exclude deleted source-linked content. Updated the Person 360 governance editor to preserve existing metadata.

## Database

- Migration: `20261027150000_knowledge_categories_trash` in `public`.
- Adds `deleted_at` and trash indexes to `knowledge_items`, `playbooks`, and `knowledge_sources`; backfills category metadata; allows the internal `other` source domain; adds the service-only `crm_knowledge_set_valid_v1` RPC.
- Rollback: `cloudbase/migrations/20261027150000_knowledge_categories_trash.rollback.sql`. It intentionally refuses to run while trash rows or sources using domain `other` exist.
- CloudBase's first `applyMigration` response reported `MIGRATION_NOT_APPLIED` despite a completed task. Follow-up `listMigrations` showed version `20261027150000` as latest, and read-only queries verified all three columns and the RPC exist. The deployed migration detail was also inspected.
- Dependency check found no public views referencing the three knowledge tables.
- Updated the public security catalog with only the new RPC's expected service-only grants; live catalog validation then passed.
- External migration backup synchronized and hash-verified at `C:\Users\victor\cloudbase\migrations`; older divergent drafts were archived under `_archive-20261027`.

## Deployment

- Cloud functions uploaded: `assistant`, `person_360`, `ai_activity`.
- Static files uploaded individually: `crm/css/console.css`, `i18n.js`, `knowledge-governance.js`, `knowledge-pages.js`, `pages/misc.js`, `router.js`, and `views.js`.
- `admin.html` was not changed.
- `tools/sync-check.ps1 -CloudOnly` passed: 90 reachable frontend assets matched; all 29 CRM functions and 219 source/config files matched the deployed cloud source.

## Regression and limitations

- Passed `test:knowledge-library` (11), `test:pc22` (12), `test:pc08` (13), `test:modular`, `test:wp02` (17), and `test:wp04` (8); JavaScript syntax checks passed.
- `test:wp01` passed with 108 browser/backend checks, zero failures, and five declared skips. `check:release-gate` passed with limitations.
- Read-only direct function invocations through CloudBase MCP were rejected by CAM authentication. CLI attempts did not produce a structured application result. Live logged-in knowledge CRUD, state changes, delete/restore, extraction, and AI generation were not verified against production data.
- The gate still marks live login evidence, service-role runtime, live writes, and real mobile verification as unverified. The three existing declared Person identity exceptions remain unchanged.

## Recovery

- Code recovery uses the pre-change release tag `release-20261027-090822`, with a new recovery commit and redeploy of the same three functions and seven frontend files; no force push.
- Database recovery requires review of current knowledge records first. The paired rollback refuses to remove recoverable trash or `other`-domain source records.
