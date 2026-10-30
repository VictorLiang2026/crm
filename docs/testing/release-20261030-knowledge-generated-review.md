# Knowledge generated-content review (2026-10-30)

## Scope and compatibility

All generated knowledge text now waits for human review before becoming active. Uploaded document/image extraction and AI-generated summaries stay in existing `draft` lifecycle. The governance page gives the linked source/item review action; approval uses the existing server-side `crm_knowledge_source_review_v1` RPC. AI-generated edits to existing system/GPT content, restores, and regeneration candidates are stored as actor-bound pending revisions. The approved content remains active while a candidate waits. Approve rechecks the record timestamp and full before-state; stale candidates cannot overwrite later edits. Discard marks a command rejected but retains it in audit history. Clearing a pair removes its text only after candidate approval; attached files are not deleted by content edits.

Manually supplied summaries keep their existing review behavior. Older approved records remain readable. No GPT provider/API was added. AI continues through configured AI Gateway/OCR. All database references are explicitly `public`; no views, routes, or Cloud Functions were renamed or deleted. Frontend changes are iPad-first and bilingual through `i18n.js`.

## Database migrations and rollback

| Version | Change | Rollback |
| --- | --- | --- |
| `20261030140000` | Add `pending_review` / `rejected` command states; pending content edits do not mutate active fields; approve/reject server operations. | `cloudbase/migrations/20261030140000_knowledge_generated_review.rollback.sql` |
| `20261030143000` | Store the edit target so approval reviews only the changed pair; restore reviews only restored pairs. | `cloudbase/migrations/20261030143000_knowledge_review_target.rollback.sql` |
| `20261030144000` | A system text or summary change invalidates prior GPT review for recorded-text items. | `cloudbase/migrations/20261030144000_knowledge_summary_review_invalidation.rollback.sql` |

CloudBase reported a false `MIGRATION_NOT_APPLIED` after each completed task. For each version, `migrationDetail` returned the exact submitted SQL, the migration list showed it applied, and read-only catalog checks confirmed the active status constraint/function definition. Latest recorded version is `20261030144000` (144 migrations total). This adapter quirk did not cause a migration retry.

Database integration used a synthetic `public.knowledge_items` row and `service_role` inside a PL/pgSQL subtransaction that intentionally rolls back on successful assertions. It verified pending content does not change active fields, approval activates only the reviewed pair, system-summary changes invalidate GPT review, and rejection preserves the previous version. Follow-up read-only counts for the synthetic item and command actor were both zero.

## Changed artifacts

- Cloud Function `assistant`: `knowledge-library-service.js`, `knowledge-content-service.js`.
- iPad console modules: knowledge governance and content-version panel.
- `crm/css/console.css` and bilingual console `i18n.js`.
- Paired public migration/rollback SQL, focused regression tests, and this record.

## Regression

- `node --check` on both changed Cloud Function files and all three changed console JavaScript modules: PASS.
- `npm run test:knowledge-library`: 61 passed, 0 failed; includes OCR/upload, generated summaries, selected-content resolver, bilingual iPad panel, and pending candidate workflow.
- `npm run test:pc08`: 13 passed, 0 failed; household/meeting-preparation context remains verified-only.
- `npm run check:shared`: 58 copies across 29 functions match shared sources.
- CloudBase `cloudbase-code-review`: reviewed service-role/actor binding, public-schema migration and rollback, RLS-preserving access, and no credential/header echo.

## Baseline and release

Baseline was checked at GitHub master `4031c572adc006f4eb8ed5e8e1ab01b6db3068cf`, with the production page/assets and all 29 function source/config sets matching. The original dirty checkout was preserved in stash `codex preserve pre-sync local WIP 20261030`; it was not included.

Release tag planned: `release-20261030-202500`. The tag will identify the published release commit.

Deployment completed to production `crm-d1gkae8ddc930d151`:

- Updated only Cloud Function `assistant` using `tools/deploy-function.ps1 -Function assistant`.
- Uploaded only `crm/css/console.css`, `crm/js/modules/console/i18n.js`, `crm/js/modules/console/knowledge-content.js`, and `crm/js/modules/console/knowledge-governance.js`; CloudBase reported 4/4 uploaded.
- Post-deploy `tools/sync-check.ps1 -CloudOnly` passed: `admin.html`, all 92 reachable page/module/style assets, and all 29 functions / 231 source/config files match.
- A read-only production invocation of `assistant` knowledge-library list returned successfully. It performed no write or regeneration. No production edit/approval was submitted.

Release gate result: `PASS_WITH_LIMITATIONS`; WP01 automated checks passed, the 108-case isolated regression passed with 5 declared skips, anonymous checks passed 78/78, and the fresh WP04 identity audit passed with 3 previously documented exceptions. Remaining evidence gaps are real interactive login, write/runtime coverage, and real mobile acceptance. No production user-interface approval flow was exercised with a human account.

## Limits

No real knowledge record was modified, and no paid OCR/model call was made. The iPad UI was exercised in an isolated browser test. A production-user UI workflow after deployment remains unverified because this session did not use an interactive logged-in browser.
