# Opportunity Person Search Rendering Fix

- Baseline: GitHub `master` and CloudBase matched at `5642b725c7ef0fa735e1b6bc7fd5ed0f2bab8ccd` before this change.
- Change: pass candidate DOM nodes individually to `replaceChildren`, so Person names render instead of `[object HTMLDivElement]`.
- Scope: `crm/js/modules/console/write.js` and the focused browser regression `tests/console/opportunity-person-search.browser.cjs`.
- Compatibility: keeps current search API, single-candidate auto-selection, multi-candidate manual selection, empty-result message, preview, and write flow.
- Data and services: no schema, migration, permission, cloud-function, or data changes.
- Targeted verification: `node --check crm/js/modules/console/write.js`; browser search, opportunity workflow, and opportunity command suites (16 passed).
- Release safety: `npm run test:wp01` passed with `PASS_WITH_LIMITATIONS`; 108 isolated regression checks passed, 5 historical presets skipped, anonymous probe 81/81 passed, fresh public catalog and identity snapshots passed, service-role read-only security checks passed. Human login, live business writes, and real mobile visual acceptance remain unverified by the WP01 report.
- Rollback: restore the previous `crm/js/modules/console/write.js` from the pre-release tag and upload only that file; publish the corresponding revert commit and tag. No database rollback is needed.
- Deployment target: `/crm/js/modules/console/write.js` only.
