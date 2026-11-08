# AI Assistant read task timeout fix — 2026-11-09

## Change

The Person summary branch of “Run read-only task” now returns its existing audited task ID as soon as generation starts and polls `person_summary` status for up to 120 seconds. The summary model call has a 100-second ceiling. Person identity confirmation, read-only data scope, task audit, and all existing direct summary/search routes remain in place. No database schema or permission changes.

The production failure was traced to a 50-second `person_summary` timeout followed by the idempotency retry guard returning `AI_RETRY_LATER`.

## Validation

- PC25: 24 passed, 0 failed; PC33 async and summary compatibility: 18 passed, 0 failed.
- WP01: 104 isolated regression cases passed, 0 failed, 5 pre-existing skips; anonymous gateway probe 81/81; public catalog 1,248 checks; WP04 retained its 3 documented identity exceptions. Release gate: `PASS_WITH_LIMITATIONS`, no blockers.
- Online source verification: 95 reachable static assets; 30 CRM functions and 243 source/config files matched after deployment.
- A live AI task was not started; production model execution and login remain unverified.

## Deployment and recovery

- Updated only the existing `assistant` function and `crm/js/modules/console/{data.js,i18n.js,pages/misc.js}` static files.
- Release tag: `release-20261109-000343`.
- To recover, restore these files from that tag’s parent, redeploy `assistant`, and upload the same three static paths. No database rollback is needed.

## Remaining verification

The release gate continues to list manual login, service-role runtime, production business writes/AI execution, and real mobile visual acceptance as unverified. The 3 documented WP04 participant identity exceptions are unchanged.
