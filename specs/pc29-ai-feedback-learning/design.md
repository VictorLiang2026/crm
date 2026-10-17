# PC29 Design

## Boundaries and compatibility

- Entry point: `#/ai/experience`, added to the AI Assistant hub. The route mounts a new module under `crm/js/modules/console/` and uses the existing `callFn` transport.
- Backend: add an `aiExperience` action to the existing authenticated `assistant` Cloud Function. Derive the actor from CloudBase identity; never trust a client UID. Use a dedicated service with strict request schemas and server-side validation.
- Database: keep all objects in `public`. Preserve `ai_results.user_selected`, `user_edited`, `final_result_json`, and `feedback` as-is so PC20 and historical readers continue to work. New decisions are append-only events.
- Outcome: reuse `public.outcomes.ai_result_id`; add optional `recruit_followup_id`, evidence, actor attribution, and idempotency key. Validate completed Actions (`status='completed'`), Opportunities (closed statuses `成交`/`关闭`), Activities (`ended`/`reviewed`), and existing non-deleted recruit follow-ups within a service-only transactional function. Existing PC18/PC20 endpoints are not rerouted.
- Learning: extend `public.learnings` with nullable PC29 metadata for sample size, counterexamples, provenance, and a candidate idempotency key. Existing rows remain valid and the existing confirmation guard remains in force.
- Database functions are `SECURITY INVOKER`, explicitly qualify `public`, and are executable only by `service_role`. Add paired forward/rollback migrations. No dependent views need rebuilding because no view columns are added or changed.

## Data model

### `public.ai_result_feedback_events`

Append-only decision events: result FK, actor UID, idempotency UUID, decision (`pending`, `accepted`, `modified`, `rejected`), optional reason, optional JSON edit delta, timestamp. Constraints require a reason on rejection and a non-empty bounded edit delta for modified acceptance. A unique idempotency key makes retries safe. Adoption reports select the latest event per result so changing a decision does not multiply the denominator.

### `public.outcomes` additions

Add `recruit_followup_id` FK, `evidence`, `recorded_by_uid`, and `idempotency_key`. Existing item links, `ai_result_id`, `result`, `notes`, and `occurred_at` remain intact. The server function accepts exactly one work-item link and verifies it under row lock before insert.

### `public.learnings` additions

Add nullable `sample_size`, `counterexamples` JSONB, `provenance` JSONB, and unique nullable `candidate_key`. PC29 candidates require non-empty source IDs, non-negative sample size, JSON array counterexamples, and JSON object provenance. The existing `source_type/source_table/source_id` fields point to the primary AI result, and existing human confirmation columns remain the only way to make a candidate confirmed.

## API operations

- `list`: bounded history of completed AI tasks/results, latest feedback decision, linked Outcomes, and Learning candidates. Do not expose prompt/context snapshots beyond existing bounded result summaries.
- `decide`: insert a decision event using an idempotency UUID; enforce exact field sets, actor, result/task relation, and retry input equality.
- `recordOutcome`: validate one completed work item plus actual result, occurrence time, evidence, optional AI result and idempotency UUID; transactionally insert one Outcome.
- `prepareLearning`: accept candidate text, scope, sample-size inputs and source IDs; server re-reads linked decisions/Outcomes, derives counts and provenance, stores an unconfirmed candidate, and returns the saved preview.
- `confirmLearning`: require explicit human confirmation and a non-empty decision; update only the Learning confirmation fields through a transaction and reject stale/replayed mismatches.

## UI design specification

- Purpose: help advisors inspect AI suggestions, record actual results, and review traceable Learning candidates.
- Aesthetic direction: industrial/utilitarian, using the existing CRM design tokens and navigation patterns.
- Palette: inherit the existing shell tokens (`--pri`, `--card`, `--border`, `--text-secondary`); use existing status colors for pending/accepted/rejected. No new theme palette.
- Typography: inherit the existing Console font stack and controls.
- Layout: iPad-first workbench; filters and result list sit in a stable left rail, while the selected result, decision editor, linked Outcomes, and Learning review occupy the larger right pane. Decision and Learning confirmation actions are separated. Portrait stacks these regions without changing mobile behavior elsewhere.
- All new copy uses the Console `t(key)` dictionary in Simplified Chinese and English. No new icon dependency; clear text controls retain visible labels.

## Regression plan

- Unit/service: strict payloads, actor derivation, edit deltas, reason requirements, idempotency replay/mismatch, latest-event metrics, completed work item validation, provenance/counterexample derivation, human-only confirmation.
- SQL: fictional public fixtures in a transaction, verify forced RLS/ACL, no duplicate decision/Outcome/Learning on replay, source relations, constraints, rollback, and cleanup by transaction rollback.
- Browser: route navigation, iPad portrait/landscape layout, bilingual labels, decision save, manual Outcome evidence, Learning preview/confirmation disclosure.
- Neighboring suites: PC15, PC18, PC20, PC23/25/26/27, Outcomes, Activity review, Recruit follow-up CRUD, AI Gateway, security/release gates.

## Rollback

Ship a paired rollback migration that drops only PC29 functions, indexes, columns, and the PC29 event table, with dependency guards. Rollback may remove PC29 feedback events and new Learning metadata; keep this as a release-level recovery operation, never run automatically after release. Existing fields and legacy flows are not dropped or rewritten.
