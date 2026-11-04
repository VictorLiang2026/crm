# Quick Capture Person search correction — 2026-11-04

## Scope

- Added a Person directory search to Console Quick Capture and legacy `admin.html` Quick Capture for cases where the AI-recognized name is wrong or a corrected name needs explicit association.
- Search is read-only. The operator must select one exact Person; the system does not auto-select by name.
- Console retains edited summary/facts through search and routes the selected Person through `capture_v2_existing` server preview, confirmation and execution.
- Legacy Quick Capture routes the selected Person through `person_360.previewIdentity` / `executeIdentity`. The selected-Person branch now includes the capture note and summary in its preview payload.
- Person-locked customer/recruit detail entry points and existing legacy customer/recruit selections are unchanged. No schema or cloud function changes.

## Regression

Command: `node --test tests/pc37/quick-capture-focused.browser.cjs tests/pc37/quick-capture-person-search.browser.cjs tests/pc37/quick-capture-focused.test.cjs tests/pc32/quick-capture-existing.browser.cjs`

Result: 14 passed, 0 failed. The synthetic browser cases verify corrected-name search, exact Person ID selection, preservation of an edited Console summary, and legacy preview-before-execute with the raw note and summary included. Existing Console capture and detail-entry flows also pass.

`npm run test:wp01`: release gate `PASS_WITH_LIMITATIONS`; all 108 isolated regression checks passed (5 documented skips), catalog and WP04 public-only audit passed, anonymous gateway probe passed 81/81. Login evidence remains manual; no live business write or real customer data was used.

## Deployment and recovery

- Static deployment targets: `/crm/admin.html`, `/crm/js/modules/console/i18n.js`, `/crm/js/modules/console/write.js`, `/crm/js/modules/phase14-hubs.js`.
- No database migration or cloud function deployment is required.
- Recovery: redeploy these four files from the preceding published tag, then create a recovery commit and tag; no data rollback is required.

## Not verified

- No production Quick Capture interaction was created. Production end-to-end interaction save remains unverified; the test used isolated synthetic fixtures and asserted that the exact Person ID, note and summary reached server preview before confirmation.
- Real login remains marked `MANUAL_LOGIN` in the WP01 report.
