# PC30 requirements: explainable proactive coach

## Scope

Add a bounded, reviewable set of deterministic relationship and work signals to Console Today. Reuse existing relationship cadence analysis, Today ranking, Morning Brief facts, and the authenticated WorkItem preview/confirm/execute flow. A user may inspect a source, defer a candidate, reject it, or confirm creation of one Action. The module never changes relationship facts or contacts a Person.

## User stories

- As an operator, I need each reminder to explain its reason, source, observation window, and confidence so I can verify it before acting.
- As an operator, I need to defer or reject a reminder and have that choice persist across sessions.
- As an operator, I need to create an Action only after reviewing the exact Person and server-verified preview.
- As an operator, I need the coach to stay quiet when evidence is insufficient or a source is unavailable.

## Acceptance criteria

1. When a true open commitment is overdue or due within the bounded horizon, the coach shall offer one candidate linked to that commitment and active Person.
2. When at least three dated real interactions establish a personal cadence and the existing relationship-decay evaluator reports a signal, the coach shall show the cadence, elapsed time, relationship importance/strength source, evidence window, and confidence; otherwise it shall report insufficient evidence or omit a candidate.
3. When a confirmed relationship edge changes recently, the coach shall describe only that the CRM relationship record changed and link to the exact edge; it shall not assert that a real-world relationship changed.
4. When an ended activity has a canonical Person participant without a later recorded follow-up, the coach shall offer a source-linked review candidate. Attendance or activity status alone shall not be represented as a completed follow-up.
5. When an active, Person-linked recruit candidate has stalled under the existing stage/follow-up rule, the coach shall offer a source-linked review candidate; deleted and terminal candidates shall not appear.
6. When a candidate is deferred or rejected, the server shall persist the decision for that authenticated operator and candidate key. A deferred candidate shall reappear after its bounded snooze time; a rejected candidate shall remain hidden for the same source version.
7. When the operator requests an Action, the Console shall use the existing WorkItem service to show a server-verified preview and require human confirmation before execution. Replaying the same candidate command shall not create a second Action.
8. When the candidate list is rendered, it shall contain at most 12 items, deduplicate identical sources, and expose whether the bounded source query was truncated.
9. When data is missing, contradictory, marked as test data, or a required source read fails, the coach shall not manufacture an actionable relationship claim; it shall display the safe empty/limited state.
10. When the user views the workspace in Simplified Chinese or English, all new UI strings shall come from the Console i18n dictionary. Layout shall follow the current iPad Today composition.

## Non-goals

- No automatic Action creation, relationship-strength edits, AI prompt/ranking changes, outbound contact, task-system rewrite, phone-specific adaptation, or broad legacy cleanup.
- Existing Today 5, Morning Brief, Person 360 relationship review, PC29 feedback/Outcome/Learning, and legacy pages retain their contracts.
