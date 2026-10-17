# PC27 release record

## Scope delivered

- Added `#/assistant/opportunities/change` in the Console AI Assistant. The workflow uses configured AI Gateway model selection, requires manual Person and exact Opportunity selection, and requires separate server preview, confirmation, and execution.
- The server accepts only allowlisted edit fields and type-compatible stage changes on active Person-only Opportunities. Closing requires a human-written result and records one matching Outcome through the existing PC15 transaction.
- Existing PC15 manual Opportunity flows and legacy customer Opportunity reads remain in place.
- New UI text is Simplified Chinese and English through the Console i18n dictionary. Layout validation covered iPad portrait and landscape.

## Database

- Applied `20261017195847_assistant_opportunity_update_close` and paired rollback in `public`.
- Applied `20261017202000_assistant_opportunity_command_jsonb_count_fix` and paired rollback in `public` after a transactional regression found the target PostgreSQL runtime does not provide `jsonb_object_length()`.
- The correction uses `jsonb_object_keys()` counts. Remote migration history reports latest version `20261017202000`.
- A transaction-only fictional fixture regression covered edit preview/execute, close preview/execute, one Outcome, replay without duplicate Outcome, and rollback. Follow-up read confirmed no fixture, Outcome, or Assistant command ledger row remained.
- No `pr` schema or `pr_*` function was queried or changed.

## Verification

- `npm run test:pc27`: 20 passed, including the `admin.html` hub-to-route browser check.
- `npm run test:pc15`: 5 passed.
- `npm run test:pc25`: 22 passed.
- `npm run test:pc26`: 18 passed.
- `npm run test:ai-gateway`: 14 passed.
- `npm run test:actions`: 5 passed.
- `npm run test:modular`: passed.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`; 108 regression checks passed, 0 failed, 5 preset skips; anonymous probe 67/67; fresh public catalog 951 checks with no unapproved drift. The identity audit retained its existing 3 declared exceptions.
- `npm run check:release-gate`: passed with the documented login, service-runtime, live-write, and mobile checks left unverified.
- Fictional production PostgreSQL transaction passed and fully rolled back. No real Opportunity or Outcome was written; no production model call was made.
- CloudBase source parity: `assistant` deployed; 29 functions / 194 source and config files match; 70 reachable static page/module/style assets match.

## Deployment

- CloudBase environment: `crm-d1gkae8ddc930d151`.
- Deployed only the `assistant` function and these static files: `crm/admin.html`, the new Opportunity Assistant module and stylesheet, `phase14-hubs.js`, and Console `i18n.js`.
- Production entry: <https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html#/ai>

## Git publication

- Published on `master` with tag `release-20261017-202906`; the commit SHA is recorded in Git history. Full Local/GitHub/CloudBase parity verification is performed by the release script before this record is finalized.
