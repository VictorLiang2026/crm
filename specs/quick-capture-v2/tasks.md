# Quick Capture V2 tasks

- [x] Extend `ai_parse.quick_capture` with an explicit read-only V2 draft, leaving the legacy branch untouched. (Requirements 1, 6)
- [x] Add server-side Person resolution and authenticated V2 commit actions to `person_360`. (Requirements 2, 4, 5)
- [x] Add restricted transactional public RPC, migration and rollback. (Requirements 4, 5)
- [x] Add default-off feature flag and modular editable preview inside the current CRM. (Requirements 1–3, 6)
- [x] Verify isolated database behavior and run V2 plus old-flow regression. (Requirement 7)
- [x] Deploy only changed artifacts, then commit, push, tag and verify local/GitHub/cloud consistency.
