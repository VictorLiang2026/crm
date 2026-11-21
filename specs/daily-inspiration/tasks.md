# Implementation Plan

- [x] 1. Confirm requirements, approved design, local/remote baseline, schema and RPC drift
  - Preserve existing worktree changes and inspect the applied production migration/RPC.
  - _Requirement: 1–8_
- [x] 2. Add reversible `public` migration
  - Persist score threshold and repeat policy, add rotation state with service-role-only RLS and explicit client-grant revocation, update RPC checks and provide guarded rollback.
  - _Requirement: 1–3, 8_
- [x] 3. Implement server selection and import preview/commit
  - Enforce eligible score server-side, record full rotation cycles and preserve legacy slot/history behavior.
  - Support multi-format batch data, exact dedupe, near-duplicate human decisions and safe retries.
  - _Requirement: 1–6_
- [x] 4. Implement iPad bilingual management UI
  - Add two-column settings/import panel, file parsing/header mapping, preview decisions and score threshold/repeat controls.
  - _Requirement: 1, 4–7_
- [x] 5. Run targeted + adjacent regression, review, publish and record evidence
  - Deploy only migration, `assistant`, affected console JS/CSS; push/tag and verify local, GitHub and CloudBase consistency.
  - _Requirement: 1–8_
