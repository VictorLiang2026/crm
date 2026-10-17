# PC29 AI Feedback, Outcomes, and Learning

## Problem and scope

AI results currently have selection/edit flags and a free-form feedback field, but they do not provide a consistent, idempotent record of pending, accepted, edited, or rejected decisions. Work item completion is not an observed business Outcome. The existing `public.outcomes.ai_result_id` already links an Outcome to an AI result, and `public.learnings` already requires human confirmation, but Learning rows do not capture sample size, counterexamples, or a complete provenance snapshot.

PC29 adds a bilingual, iPad-first Console workspace for AI result decisions, human-recorded Outcomes, and Learning candidates. New data remains in `public`; service-role access remains server-side. Existing AI result fields, PC18 Activity review, PC20 Recruit Coach, PC15 Opportunity, and legacy manual workflows remain compatible.

## User stories

1. As an advisor, I can inspect an AI result and record pending, accepted, accepted-after-edit, or rejected, with a reason and edit delta where applicable.
2. As an advisor, I can record what actually happened after an Action, Opportunity, Activity, or recruit follow-up, including when it happened and supporting evidence.
3. As a reviewer, I can prepare a Learning candidate from linked decisions and actual Outcomes, inspect its scope, sample size, counterexamples, and source records, then confirm it as a human.
4. As an auditor, I can trace a decision, Outcome, and Learning candidate by stable IDs; retrying a request does not duplicate the decision, Outcome, or Learning candidate.

## Acceptance criteria (EARS)

### Feedback and adoption

- When a signed-in user opens a result without a decision event, the workspace shall present it as pending without writing a decision.
- When a user records a decision, the server shall validate the actor and result, store the decision/reason/edit delta, and preserve the legacy `ai_results` row and PC20 decision fields.
- When a user marks a result accepted after editing, the system shall require and store a bounded before/after edit delta.
- When a user rejects a result, the system shall require a reason.
- When the same idempotency key is replayed with identical input, the system shall return the original decision event and shall not count it twice; when the key is reused with different input, it shall reject the request.
- When a user opens or copies an AI result, the system shall not count that as adoption.
- When metrics are displayed, the system shall show numerator, denominator, and time window, keep decision states distinct, and avoid claiming generic AI uplift.

### Actual Outcomes

- When an eligible completed work item is selected, the server shall verify the item and its Person/candidate relationship before recording an Outcome.
- When an Outcome is recorded, the user shall provide actual result, occurrence time, and evidence; completion status alone shall not create or infer an Outcome.
- When an Outcome is linked to an AI result, the server shall verify the result and persist the existing `ai_result_id` relation.
- When a record retry occurs, the idempotency key shall prevent duplicate Outcomes.
- When an Activity is used, existing PC18 review and Outcome behavior shall remain available and its existing status vocabulary shall be preserved (`ended` / `reviewed` are completed activity states).
- When a recruit follow-up is used, the Outcome shall link to the follow-up record and candidate; the old follow-up CRUD path shall not change.

### Learning

- When a Learning candidate is prepared, it shall include a scope, sample size, counterexamples, and machine-readable provenance identifying the source AI results and Outcomes.
- When a candidate is persisted, it shall remain unconfirmed until an authenticated human explicitly confirms it with a decision.
- When the same candidate request is replayed, it shall return the existing candidate instead of creating a duplicate.
- When Learning confirmation occurs, existing source immutability and human-confirmation constraints shall continue to apply.
- The system shall not automatically change prompts, model configuration, ranking, or scoring.

### Security, compatibility, and interface

- All new and changed business data operations shall explicitly target `public`; no `pr` schema object or `pr_*` Cloud Function shall be accessed or changed.
- New audit tables and functions shall be accessible only to `service_role`; the client shall use the existing authenticated `assistant` Cloud Function boundary.
- When any new text is shown, the Console shall resolve it through `t(key)` in Simplified Chinese (default) and English dictionaries.
- The workspace shall target iPad portrait and landscape; it shall not add a new mobile layout acceptance requirement.
- PC18, PC20, PC15, historical AI result reads, work item CRUD, permissions, and existing manual Outcome flows shall pass regression using fictional fixtures only.

## Non-goals

- No automatic positive Outcome inference from a completed status.
- No automatic prompt, model, ranking, or score adaptation.
- No rewrite or removal of legacy feedback fields, PC18 Activity review, PC20 Recruit Coach, PC15 Opportunity workflows, or `admin.html` business logic.
- No real customer data writes in tests.
- No changes outside the approved PC29 package.
