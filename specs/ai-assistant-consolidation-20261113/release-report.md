# AI Assistant Consolidation — Release Record

## Scope and impact

- Base: `origin/master` `3a55656c` (`release-20261113-075120`). The user-owned activity WIP in `D:\CRM\crm` remains untouched; implementation is isolated in `D:\CRM\crm-ai-assistant`.
- Console `#/ai` is the single AI home. Legacy AI hashes continue to resolve as redirects. Action and Opportunity modules use their existing server-verified Preview → human Confirm → scoped Execute flow.
- The old Activity “relationship review preview” widget entry was removed because Console Activity Review already uses the same PC18 service and human review flow. The legacy module file remains available but is no longer loaded from the old Activity page.
- Opportunity analysis remains unimplemented and is no longer presented as an available action. Person summary, meeting preparation, Activity Review, and Today brief link to their existing canonical pages.
- AI Results & Outcomes now uses clearer filter, result detail, Actual Outcome, and Learning sections; selection synchronizes the related-result selector. Service payloads and data contracts are unchanged.
- Impacted UI: `admin.html`, Console AI home/routes, Action create module, AI Results & Outcomes, and their styles/i18n. No database, Cloud Function, permission, model routing, or business-data change.

## Verification completed before publication

- PC38 route/language/iPad browser regression: 1 passed.
- PC18 review suite: 5 passed. PC26 Action suite: 21 passed. PC27 Opportunity suite: 20 passed. PC29 AI Results suite: 12 passed.
- Regression browser short group: 49 passed, 0 failed. Regression browser long group: 18 passed, 0 failed.
- WP01 full gate, refreshed after rebasing onto the latest `master`: `PASS_WITH_LIMITATIONS`; public catalog 1,514 checks passed, public identity audit had no exceptions, anonymous read-only probe 104/104 passed, PC34 read-only and iPad checks passed, and complete regression passed (102 browser checks, 0 failures).
- Release gate limitations retained by policy: real account login and service-runtime credentials were not tested; no live business writes or mobile acceptance was performed.
- All online database observations were read-only and explicitly constrained to `public`. No `pr` schema or `pr_*` function was queried or called.

## Deployment and rollback

- Deployment: CloudBase static hosting accepted all 9 changed files, with no failed uploads:
  - `admin.html` → `/crm/admin.html`
  - `crm/css/console.css`
  - `crm/css/ai-experience.css`
  - `crm/js/modules/assistant-action-create.js`
  - `crm/js/modules/console/ai-experience.js`
  - `crm/js/modules/console/i18n.js`
  - `crm/js/modules/console/pages/misc.js`
  - `crm/js/modules/console/router.js`
  - `crm/js/modules/phase14-hubs.js`
- During publication GitHub `master` advanced from the recorded base to `bd98c24` with two knowledge-PDF OCR commits. The implementation was rebased onto that master. This exposed an upstream `kg_ocr_auth_failed` dictionary key; it was preserved and `crm/js/modules/console/i18n.js` was uploaded once more so the production file includes both upstream and AI Assistant entries.
- Post-deploy check: each of the 9 public URLs returned HTTP 200 and matched the rebased local file by normalized SHA-256. The full reachable static asset check also passed (102/102 assets match CloudBase).
- No Cloud Function or database deployment.
- Rollback source: `release-20261113-075120`. Restore only the changed static files from that release and verify the same paths online.
- The standard `tools/release.ps1` / `tools/sync-check.ps1` path was not run because its configured function inventory includes forbidden `pr_*` functions. The scoped WP01 gate and CloudBase online file checks above were used instead; no `pr_*` function was queried or called.
- WP01 release gate after the final test adjustments: `PASS`; permitted gaps remain for manual login, service-runtime credential validation, live business writes, and mobile acceptance. All 102 reachable page/module/style assets match CloudBase.
- Git commit, master push, tag, and final consistency checks are recorded after publication below.
