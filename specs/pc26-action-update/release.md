# PC26 release record

## Scope

- Adds authenticated natural-language Action update and completion, limited to `action_type`, `title`, `description`, `due_at`, and `priority`; completion transitions open/in-progress Actions to completed.
- Adds the bilingual iPad-first entry from AI Assistant. Person and exact Action are always manually selected. The server rereads both records, binds their versions and the actor to a 15-minute command, and returns the before/after preview for a separate explicit confirmation.
- Retains the existing Action create command and PC06 manual Person/Today workflows. No Commitment, Opportunity, delete, reopen, bulk edit, or other schema changes.
- Database changes are limited to `public.assistant_action_commands` and its existing service-role RPC. Both forward migrations have paired rollback SQL.

## Implementation and database

- Migration `20261017170550_assistant_action_update_close` was applied and verified.
- Its first real transaction probe found that close-plan left the non-null draft unset. No changes persisted from that failed probe. Corrective migration `20261017193000_assistant_action_close_draft_fix` was then applied and verified.
- Transaction regression used only registered fictional `public.crm_test_records` Person `783` / Action `6`, tested cross-Person rejection, verified before/after, forged confirmation rejection, optimistic version rejection, update, close timestamp/actor and replay idempotency. The transaction ended with a rollback sentinel. Follow-up read confirmed Action `6` remains open with its original title/priority/updated_at and zero `pc26-rollback-only-test` command rows.

## Regression

- `npm run test:pc26`: 18 PASS, 0 FAIL; includes model contract parity, server input/identity/scope guards, and Chinese/English iPad portrait/landscape browser flows for update and close. Execute remained disabled until the separate human confirmation and explicit execute clicks.
- `npm run test:pc25`: 22 PASS, 0 FAIL; PC25 read-only assistant behavior retained.
- `npm run test:ai-gateway`: 14 PASS, 0 FAIL.
- `npm run test:actions`: 5 PASS, 0 FAIL; old Action list/create/complete behavior retained.
- `node --test tests/assistant/action-create.cjs tests/wp08/work-items.test.cjs tests/pc06/work-items.browser.cjs`: 11 PASS, 0 FAIL; old assistant create and PC06 Person/Today work-item flows retained.
- Production transaction test passed using only registered fictional Person `783` / Action `6`; it verified allowlists, cross-Person rejection, expired/stale versions, forged confirmation rejection, update, close actor/time, and replay idempotency. A follow-up query confirmed Action `6` and its version were unchanged and no command ledger rows remained for the test actor.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`; catalog 937 checks, regression 108 PASS / 0 FAIL / 5 declared SKIP, anonymous object probe 66/66, and WP04 `PASS_WITH_EXCEPTIONS` for 3 declared identity exceptions. `npm run check:release-gate` passed. Manual login, service-role runtime probe, live business writes, and mobile acceptance remain unverified by design.

## Deployment

- Production environment: `crm-d1gkae8ddc930d151`.
- Applied migrations: `20261017170550_assistant_action_update_close`, `20261017193000_assistant_action_close_draft_fix` (remote latest migration `20261017193000`). Both have paired rollback files; rollback of the base migration refuses if non-create command audit exists.
- Deployed the `assistant` function only. Its code upload succeeded. The safe CLI invoke used an empty Action-interpret request and returned `UNAUTHORIZED` before parsing, database access, or model invocation (RequestId `532c8265-0715-4542-b105-f661104e2051`). The CloudBase MCP invoke adapter returned `Cam authentication failed`; the authenticated CLI probe supplied the successful runtime result.
- Uploaded only five static assets: `/crm/admin.html`, `/crm/js/modules/assistant-action-change.js`, `/crm/js/modules/phase14-hubs.js`, `/crm/js/modules/console/i18n.js`, and `/crm/css/assistant-action-change.css`.
- Post-deploy `sync-check.ps1 -CloudOnly`: admin page SHA-256 matched, all 68 reachable page/module/style assets matched, and all 29 Cloud Functions / 191 source and config files matched CloudBase.
- Production URL: https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html
- No production model call or real customer Action mutation was performed.

## Git

Release tag: `release-20261017-173414`. The repository release script creates the commit, pushes `master`, and pushes this tag after its cloud parity checks pass.

## PC36 E12: Action change progress messages (2026-10-22)

- Scope: the existing Action change page now shows a bilingual “plan ready; load verified preview” message after a successful Plan, and a “verified preview shown below” message after Preview. The Command → Plan → Preview → human Confirm → Execute sequence, buttons, backend, database, and manual workflows are unchanged. Only `/crm/js/modules/assistant-action-change.js` and `/crm/js/modules/console/i18n.js` were uploaded.
- Production diagnosis: the fictional Person #786 / Action #18 produced correctly scoped, 15-minute `planned` commands, while the page remained on “处理中”. A read-only check found no preview, confirmation, execution, or Action mutation. The original title, medium priority, and open status remained intact. Expired plans are not reused.
- Validation: `npm run test:pc26` 21/21, `npm run test:pc27` 20/20, `npm test` 108 PASS / 0 FAIL / 5 historical SKIP. The browser test now asserts both Chinese messages and the English Preview message in the iPad flow. Syntax and diff checks passed. CloudBase review found no changes to auth, RPC payloads, permissions, storage, or model selection.
- Release gate: fresh `public` catalog and WP04 identity snapshots; WP04 retained the three documented participant exceptions. `npm run test:wp01` finished `PASS_WITH_LIMITATIONS`: catalog 1036 checks, anonymous gateway 71/71, isolated old-route regression 108 PASS / 0 FAIL / 5 SKIP. `npm run check:release-gate` passed. Manual login, service-role write probe, production Action mutation, and real iPad device checks remain unverified for this presentation-only patch.
- Deployment: CloudBase static hosting accepted exactly the two files above (2/2). The `assistant` function and `public` schema were not changed. Rollback is a recovery commit based on the prior tag `release-20261021-111732`, uploading only these two prior static files; do not roll back business data.
- Git release tag: `release-20261022-004100`; final cloud/GitHub parity and live page acceptance are recorded in the release result.
