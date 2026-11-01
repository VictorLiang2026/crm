# Knowledge PDF upload retry errors — 2026-11-01

## Scope and impact

- Distinguish extraction `TIMEOUT` and `AI_RETRY_LATER` from generic PDF upload errors.
- Identify the failed volume and page range in the status message.
- Explain that completed volumes continue processing and direct the operator to retry only the failed source in the knowledge library.
- Preserve the 30-page split size, sequential upload behavior, source records, approval workflow, and retry API.
- No database, permission, or Cloud Function changes.

## Verification

- `node --test tests/knowledge-library/pdf-split.browser.cjs` — PASS; includes timeout and AI busy failures on the second volume, volume/page context, partial success retention, and Chinese/English copy.
- `node --test tests/pc22/knowledge-governance.browser.cjs` — PASS (2 tests), including failed-source retry state.
- `node --test tests/knowledge-library/management.test.cjs` — PASS (12 tests); used existing dependencies from the primary workspace via `NODE_PATH`.
- Syntax checks for the three changed JavaScript files and browser test — PASS.
- `npm run test:wp01` — PASS_WITH_LIMITATIONS; 108 regression checks passed, 5 historical skips. Anonymous probe passed 81/81; WP04 audit passed with its 3 previously declared identity exceptions.
- `npm run check:release-gate` — PASS. Manual login, service-runtime write probe, live writes, and mobile verification remain unverified per gate report.

## Rollback

Revert this release commit and upload the previous versions of the three changed assets to their same `/crm/js/modules/console/` paths. No database or user data rollback is required.

## Release

- Release tag: `release-20261101-2105`.
- Deployment scope: `knowledge-pages.js`, `knowledge-pdf-upload.js`, and `i18n.js` only.
- CloudBase deployment: all 3 files uploaded successfully.
- Post-deployment `sync-check.ps1 -CloudOnly`: PASS; 96 reachable front-end assets and all 243 source/config files across 30 functions match production. `admin.html` returns HTTP 200 with a matching SHA-256.
- No Cloud Function or database deployment was needed.
