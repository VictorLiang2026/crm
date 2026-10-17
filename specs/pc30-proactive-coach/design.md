# PC30 design: explainable proactive coach

## Purpose and visual direction

Today gains a small, review-first coach panel that turns existing facts into a limited queue of candidates. The panel uses the Console's industrial operations-desk direction and existing asymmetric Today layout. It reuses `--red: #D31145`, `--ink: #2E333B`, `--gold: #A87A1E`, `--jade: #1B8A5E`, and `--bg: #F5F5F7`; typography remains the current Console font stack. These are existing design-system overrides to generic font/color defaults.

The panel sits in the existing Today right column alongside relationship/rhythm content. Candidate rows show signal, Person, short explanation, confidence, data window, exact public source, and a compact row of actions. The layout uses the current iPad column structure; portrait follows the existing stacked order.

## Architecture

- `cloudfunctions/person_360/proactive-coach-service.js` builds deterministic candidates from bounded `public` reads, reusing `RelationshipDecayService` and existing source-specific rules. It returns no more than 12 candidates and a truncation/coverage note.
- New read and decision routes are additive to `person_360`; existing routes are unchanged.
- A minimal `public.crm_proactive_coach_decisions` table stores only actor, candidate key, source identity, decision, snooze time, and confirmed Action id. It does not snapshot source text or candidate claims. RLS is enabled and forced; only the existing server service role can read/write it.
- `crm_proactive_coach_decision_v1` validates active Person/source binding, actor, decision, snooze window, and Action ownership. Candidate keys are stable for a source version. Rejections suppress that version; deferrals expire and may be set once more for up to 30 days; created-Action state is terminal.
- Action creation reuses `WorkItemService.preview()` and `.execute()`. The candidate key supplies the idempotency key; a successful execute is followed by a state record. If the state write fails, a retry receives the existing idempotent WorkItem result and cannot create a duplicate.
- `crm/js/modules/console/pages/today.js` adds one candidate card and safe refresh handling. Existing Today 5, commitments, opportunities, rhythm, and Morning Brief code paths remain in place. New strings are added to `i18n.js`.

## Signal boundaries

- Open commitment due/overdue: direct `public.commitments` row and active Person.
- Relationship cadence: use the existing deterministic evaluator; no decay candidate when the required dated history/relationship evidence is absent.
- Relationship change: report only a recent change to a confirmed CRM edge; do not infer a real-world event or relationship deterioration.
- Activity follow-up: ended activity, active canonical Person participant, and no later recorded follow-up or open Action for that Person/activity.
- Recruit stagnation: active Person-linked non-terminal candidate using existing stage age and latest follow-up rules.
- Every source read has an explicit row cap and time window. A cap hit is visible; missing/failed sources do not become zero or negative facts.
- Test-data provenance is preserved and visible; no generated test data is created by the feature.

## Security and compatibility

- All SQL uses `public` qualified objects, explicit `search_path`, no cross-schema dependency, and paired migration/rollback.
- The caller identity comes only from the existing authenticated non-anonymous CloudBase context. Client-provided actor IDs, Person IDs, source details, and a `confirmed` flag do not authorize writes.
- Decisions go through a service-role-only RPC. Action creation goes through the existing time-bounded, actor-bound, state-checked work-item preview and execute RPCs.
- No direct browser database access, no new model/provider selection, no AI claim presented as a fact, and no external message.
- No existing route/table/function is deleted or renamed. Legacy admin page and old Today/AI contracts remain unchanged.

## Validation

Fictional-only transaction coverage checks defer/reject/reopen-after-snooze and source binding. Unit tests cover caps, signal evidence, dedupe, missing data, deleted rows, and test provenance. Browser tests cover iPad landscape/portrait, bilingual rendering, source navigation, deferral/rejection, server preview, cancellation, and one confirmed Action. Regress PC08-PC10, PC18-PC21, PC29, Today/Morning Brief, commitments, activities, and recruitment.
