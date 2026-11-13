# Implementation Tasks

- [x] 1. Add Console routes for existing Action create/change and Opportunity change modules. Preserve their current API contracts and safety stages. _Requirement: 1, 3_
- [x] 2. Verify the existing Console Activity review tab covers the old relationship-review preview, then remove only the duplicate legacy widget entry/import. _Requirement: 4_
- [x] 3. Rebuild the Console AI home with supported links, canonical People/Today destinations, AI Results & Outcomes, and no unsupported Opportunity Analysis action. _Requirement: 1, 5, 6, 9_
- [x] 4. Redirect legacy AI hashes to Console destinations while preserving unrelated legacy routes and compatibility URLs. _Requirement: 2_
- [x] 5. Reorganize AI Results & Outcomes layout for iPad portrait/landscape without changing its service payloads. _Requirement: 7, 8, 9, 10_
- [x] 6. Add route, browser, language, workflow, and layout regression coverage. _Requirement: 1-10_
- [x] 7. Run scoped release verification, deploy only changed static assets, then commit, push, tag, and verify GitHub/hosting consistency. _Requirement: 10_
