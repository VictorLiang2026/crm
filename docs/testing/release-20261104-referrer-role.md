# Referrer role filter correction — 2026-11-04

## Baseline and cause

- Base: GitHub `master` `74ec8724c81909e7b68265efb9fe2c97a88cee02`, tag `release-20261104-2228`. CloudOnly source check passed: 96 reachable page/module/style assets and 30 functions/243 source/config files matched.
- Read-only production aggregate: 791 active People; zero `public.person_roles` rows with `role='referrer'`; 158 active People have `persons.referral_priority` A–E. The directory filters roles by `person_roles`, so every Referrer selection returned no rows. Referral priority is a separate Person field.
- The previous UI had no way to maintain the manual `referrer` role.

## Scope and compatibility

- Person overview shows the current Referrer role and a reviewed mark/remove action. The server requires an authenticated nonanonymous caller, an active Person, a boolean target, and the current expected role state. It writes only a `public.person_roles` row for `referrer`, then reads it back.
- People filter explains the manual role and gives a specific empty state. Existing role, priority, search, sorting and pagination semantics remain unchanged. No existing data is automatically reclassified.
- Simplified Chinese and English copy use Console i18n. The existing `admin.html` implementation, customer/recruit role derivation, `recommender_id`, data fields, permissions, routes and schema remain unchanged. No migration or rollback SQL is required.

## Verification

- Syntax checks for changed JS and `git diff --check`: passed.
- `node --test tests/phase14/referrer-role.cjs`: 2 passed (mark/remove scope, stale state, deleted Person, invalid actor).
- `node --test tests/console/referrer-role.browser.cjs`: 2 passed (review before write, status refresh, filter explanation/empty state, both languages).
- `node --test tests/console/people-pages.browser.cjs`: 5 passed.
- `node --test tests/phase14/person-directory.cjs`: 4 passed.
- `npm test`: 108 passed, 0 failed, 5 skipped; includes login, customer detail/list, follow-up, activity, recruit and recycle flows.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`, no blockers; 1248 catalog checks, public-only identity audit, 81/81 anonymous gateway checks and PC34 iPad bilingual/security checks passed.
- CloudBase code review: existing service-role-only RLS and unique role index verified online; no credentials or database key are exposed to the browser.

## Deployment and recovery

- Deploy only `person_360` and five Console JS files: `data.js`, `i18n.js`, `pages/people.js`, `pages/person.js`, `write.js`.
- Recovery: redeploy these six artifacts from `release-20261104-2228` (or the immediately preceding release tag if master advances), then create a recovery commit and tag. Do not delete any Person role data automatically; assess any role rows entered after release before a data rollback.

## Not verified

- No production customer data was changed during tests. Real authenticated mark/remove on a fictional Person is pending postdeployment verification; if not possible, report it separately.
- Existing WP01 manual-login limitation remains.
