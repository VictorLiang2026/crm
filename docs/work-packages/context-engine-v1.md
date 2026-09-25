# Context Engine V1 work package

Implemented six bounded, read-only public-schema context recipes in `cloudfunctions/_shared/context-engine.js`. The builder selects only approved columns, caps rows and text, excludes soft-deleted records, identifies each source, and returns both the model context and a provenance-bearing `context_snapshot`. AI Gateway now accepts the optional snapshot and verifies it matches the model context before persisting to `public.ai_tasks.context_snapshot`; existing calls continue to use the original path.

Verified the exact public table columns through a read-only CloudBase schema query before implementation. The checked tables were `customers`, `followups`, `opportunities`, `products`, `policy_review_reports`, `activities`, `activity_participants`, `activity_tasks`, `recruit_candidates`, and `recruit_followups`. No `pr` objects were read. Candidate name and occupation resolve through the linked customer. No DB migration or cloud deployment is required because no existing deployed function imports this shared module.

Validation: `npm run test:context-engine` passed 19/19; `npm test` passed 57 with 0 failures and 5 expected skips; `npm run check:shared`, syntax checks, and `git diff --check` passed. The first browser run under a restricted environment timed out at browser startup; the normal release environment passed all browser cases. Tests use synthetic records and no production writes.

Remaining limit: this is a foundation module, not an invoked production feature. A future caller must use an authorized server-side RDB client and pass both `context` and `contextSnapshot` to AI Gateway. No live customer record was sent to a model during this work package. Cloud-hosted CRM page and functions remain unchanged.
