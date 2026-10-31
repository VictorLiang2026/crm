# Active module button colors — 2026-10-31

## Scope

Make the selected module, tab, or pressed view button clearly distinct using the existing CRM red with white text; selected hover uses the existing darker red. Switching selection restores the previous item to its neutral appearance. Only foreground, background, and border colors changed; layout, shape, labels, routes, APIs, business actions, and data behavior did not.

Changed files: `admin.html`, `crm/css/console.css`, and `crm/css/phase14-navigation.css`. No database, Cloud Function, API, or permission changes.

## Baseline and release

- Release baseline: `35a676f7df4d410faabac8532d3396f7d0e7d93f` (`origin/master`, tag `release-20261031-1428`).
- The initial stale checkout predated the separately published follow-up advice release. That release added `person_followup_advice` and its sequence to the public security baseline, resolving the apparent catalog drift. Work resumed on the current master without bringing other uncommitted work into this package.
- The pre-change CloudBase sync check passed against the release baseline. After upload, the main page and 96 reachable static assets matched; all 29 Cloud Functions / 237 source and configuration files matched the unchanged cloud baseline.
- Uploaded exactly `/crm/admin.html`, `/crm/css/console.css`, and `/crm/css/phase14-navigation.css`.
- Recovery: restore these three files from `release-20261031-1428`, upload the same paths, then verify with `tools/sync-check.ps1`.

## Verification

- `git diff --check`: passed.
- `npm run test:pc03`: 4 passed, 0 failed.
- `npm run test:modular`: passed.
- Browser check: the console highlighted 人物, then only 活动 after switching; the prior button returned to neutral. Legacy 更多 module button also rendered red with white text. Passed with no fixture errors.
- `npm run test:wp04`: 8 passed; public identity audit passed with 3 previously declared exceptions.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`; catalog passed with no drift, anonymous probe 79/79, and regression 108 passed / 0 failed / 5 skipped. Release gate passed. Remaining report items: manual login, service-role runtime write probe, live business writes, and real mobile visual acceptance were not executed.
- Post-upload `tools/sync-check.ps1 -CloudOnly`: passed; all 3 modified page/style assets and the remaining reachable assets matched CloudBase. Cloud Functions unchanged and matched.

## Publication

Static assets published to `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/`. No functions or database objects were deployed or changed. Git commit, tag, and push are recorded in the release result.
