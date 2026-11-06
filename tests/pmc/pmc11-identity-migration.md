# PMC11 Person AI Gateway migration status

The original PMC11 assertions targeted legacy AI prompts, `customers` profile fields, and direct persistence behavior. Those assertions do not describe the current Person AI Gateway contracts and remain retired.

The endpoint-by-endpoint inventory is maintained in [`docs/work-packages/pmc11-person-ai-gateway-mapping-20261107.md`](../../docs/work-packages/pmc11-person-ai-gateway-mapping-20261107.md). It distinguishes active Legacy consumers from current Gateway routes. The inventory confirms that several Legacy AI functions still have live callers and are not replaced by the new Person experience; do not infer migration or remove their behavior.

## Existing Gateway coverage

- `tests/pc20/recruit-coach.test.cjs` and `tests/pc20/recruit-coach.browser.cjs`: candidate-scoped Gateway context, generation without business writes, candidate-bound human decisions/history, and Console UI flow.
- `tests/pc23/person-ai-history.test.cjs`, `tests/pc23/conversation-history.test.cjs`, and `tests/pc23/assistant-history-auth.test.cjs`: Person-owned history, public source references, legacy advice linked through Customer, deleted-Person isolation, and authentication.
- `tests/pc33/ai-async-response.test.cjs`, `tests/pc33/meeting-prep-async.test.cjs`, and `tests/pc33/person-ai-resilience.browser.cjs`: async task lifecycle, supported task types, timeout/recovery, duplicate-click handling, and prior-result reuse.
- `tests/pc29/ai-experience.test.cjs` and `tests/pc29/ai-experience.browser.cjs`: human decisions, outcomes, learning lineage, and confirmation boundary.
- `tests/pmc/pmc12-recruit.test.cjs`: legacy recruit functions keep Person-first identity with the documented legacy fallback and conflict behavior.

These tests cover the current Gateway behavior found in the inventory. No new assertion was added here because the identified unresolved items concern old endpoints that still have active Legacy callers; asserting that they are migrated would be false. Keep the PMC11 TODO visible until each active old path either has an approved replacement and compatibility plan or is explicitly classified as intentionally Legacy-only with verified identity/write semantics.

```text
TODO: PMC11 legacy AI identity suite is retired; endpoint-by-endpoint replacement/compatibility closure remains incomplete.
```
