# Candidate soft-delete permission fix

## Scope and baseline

- Baseline: `e67ed17`; tag `release-20261028-1221`.
- User-approved scope: modify only `public.crm_delete_batch` so customer-linked candidate removal does not request an unnecessary row lock on `public.persons`. Person-only candidate removal keeps its existing controlled lock path.
- No page, route, cloud function, table, view, grant, RLS policy, or function signature change.
- Removal continues to soft-delete only the candidate and same-batch recruit follow-ups. It does not update or delete the Person row. Existing reactivation confirmation and restore flow remains in place.

## Migration and rollback

- Migration: `20261028160000_crm_delete_batch_skip_empty_person_lock.sql`.
- Rollback: `20261028160000_crm_delete_batch_skip_empty_person_lock.rollback.sql` restores the prior function definition. It also restores the unconditional Person lock and therefore reintroduces the reported permission failure for customer-linked candidates.
- Migration precondition checks that the current function definition matches the inspected production baseline hash before replacement.
- Applied to production `crm-d1gkae8ddc930d151`, instance `cloudbase-pg`, schema `public`. `listMigrations` reports version `20261028160000`; live `pg_get_functiondef` contains the guarded lock. Function remains `SECURITY INVOKER`, owned by `cloudbase_postgres_pgdb_pn3idppt`.
- The initial apply response reported a temporary verification mismatch even though its migration task succeeded. Follow-up `describeMigrationTask`, `listMigrations`, `migrationDetail`, and a read-only function catalog query verified application.

## Regression and safety review

- `tests/pc28/recruit-delete.test.cjs`: 9 passed. Covers guarded Person lock, candidate/follow-up soft-delete and restore scope, rollback behavior, and no Person mutation or `pr` schema references.
- `npm run test:pc19`: 11 passed. Confirms Person-only routing remains on `person_360` and customer-linked candidates retain the existing removal route.
- `npm run test:pc35`: 12 passed. Confirms neighboring recycle/restore behavior.
- `node --test tests/wp071/identity.test.cjs`: 7 passed.
- No real candidate, customer, Person, or follow-up data was changed for testing.
- No view rebuild was needed: no base-table columns or function signature changed. No grants or RLS policies changed.
- Full regression through WP01: `108 PASS`, `0 FAIL`, `5` existing skips. WP01 status: `PASS_WITH_LIMITATIONS`; catalog checks `1162/1162`, anonymous probe `77/77`, login and authenticated read-denial checks passed. The three explicitly unverified items are service-role runtime writes, production business writes, and real mobile visual acceptance.
- WP04 identity audit: `PASS_WITH_EXCEPTIONS`; 782/782 active customers, 576/576 active recruits, 5/5 speakers mapped; three previously declared participant exceptions retained. No new exception was introduced.
- Release gate, final sync, and Git publication: pending execution.

## Deployment

- Database deployment only; no web assets or Cloud Functions require redeployment.
- No Cloud Function or static asset changed, so no function/hosting upload is required. The release procedure will verify that cloud source remains byte-identical and will record the commit/tag and final three-way sync result.
