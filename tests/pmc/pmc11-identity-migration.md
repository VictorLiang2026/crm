# PMC11 identity test migration

The former suite called legacy AI event functions directly and asserted their old prompt, profile-field, and persistence contracts. Those expectations no longer describe the current Person AI Gateway flow, and several fields formerly read from `customers` have since become Person-owned.

The old assertions are retired. The current automated coverage is distributed across:

- `tests/pc20/recruit-coach.test.cjs` and `tests/pc20/recruit-coach.browser.cjs` for candidate-scoped Gateway generation and human-confirmed outcomes.
- `tests/pc23/person-ai-history.test.cjs`, `tests/pc23/conversation-history.test.cjs`, and `tests/pc23/assistant-history-auth.test.cjs` for Person AI history and access boundaries.
- `tests/pc33/ai-async-response.test.cjs` and `tests/pc33/person-ai-resilience.browser.cjs` for durable task lifecycle, timeout, and Person AI UI recovery.
- `tests/pc29/ai-experience.test.cjs` for task/result/decision/outcome lineage.

**Remaining gap:** these suites do not yet prove that every old AI endpoint has a deliberate compatibility response or a verified replacement route. Keep this todo visible until endpoint-by-endpoint routing is mapped. Do not infer that deleting the old assertions removed or migrated any Cloud Function behavior.
