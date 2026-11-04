# Morning Brief priority links — 2026-11-04

## Scope and cause

- Morning Brief Top 5 links were built from legacy `v_action_center` identities. Customer IDs and recruit candidate IDs were placed directly into Console routes, which only resolve Person and activity IDs; unsupported hashes fell back to Today.
- `today_coach` now resolves active legacy customer IDs through `customers.person_id`, and recruit candidate IDs through `recruit_candidates.person_id` with an associated customer fallback. Unresolvable identities open the People directory. Activity and canonical Person routes remain direct.
- Added `person_id` to the existing active recruit-candidate read. No schema, route, write, AI, or ranking behavior changed.

## Regression

- `node --test tests/today-coach/morning-brief.cjs tests/today-coach/morning-route.cjs`: 7 passed.
- `npm test`: 108 passed, 0 failed, 5 documented skips. Includes an isolated Console click that opens the target Person record.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`; public catalog 1248 checks passed, public-only WP04 audit passed with 3 documented exceptions, anonymous gateway 81/81 passed, PC34 checks passed. Remaining documented gaps: manual login, service runtime, production writes and mobile visual acceptance.
- Syntax, `git diff --check`, and shared-file check passed.
- Production direct invocation via management tool returned the app-level `UNAUTHORIZED` response because it does not provide an authenticated application user. No business rows were written or exposed by the verification. Authenticated live click-through remains unverified.

## Deployment and consistency

- Deployed only `cloudfunctions/today_coach` to `crm-d1gkae8ddc930d151`; CloudBase CLI confirmed `Code updated`.
- During post-deploy parity check, the Console asset `crm/js/modules/console/data.js` was found to contain the already-deployed `setReferrerRole` line from local commit `a6cf6a8463bbaf6e77c55b417af7defd024062b0`, while GitHub master was still at `74ec8724c81909e7b68265efb9fe2c97a88cee02`. This existing change is preserved and carried into the combined release so CloudBase is not overwritten.
- Final GitHub master SHA, release tag, and CloudBase source comparison are recorded after publication.

## Recovery

- Restore only `today_coach` from `release-20261104-2228` and create a recovery commit/tag. No database rollback is required.

## Not verified

- The deployed function was not exercised with an authenticated production user; the direct management invocation lacks that application session.
- No live customer activity or write was performed.
