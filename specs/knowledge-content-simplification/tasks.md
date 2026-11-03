# Implementation Plan

- [x] 1. Reshape Basic Information and Content Confirmation layouts
  - Show system and GPT summaries side by side with a full-width system original below.
  - Increase the iPad confirmation sheet to 1128px maximum and group per-field actions.
  - Keep phone behavior untouched and all labels in the bilingual dictionary.
  - _Requirement: 1–3, 10_

- [x] 2. Replace content review UI with direct edit actions
  - Remove preview/approve/reject/adopt/history/candidate/progress/retry controls and pending-review badge.
  - Add direct Save and clear actions for system/GPT fields.
  - _Requirement: 3–4, 7_

- [x] 3. Implement direct server saves and regeneration completion
  - Add exact-ID, `updated_at`-checked save operation to the existing RPC.
  - Keep internal long-document worker queue; write completion directly and remove user-facing command/history APIs from this workflow.
  - Mark directly saved complete content usable while retaining source/lifecycle checks.
  - _Requirement: 4–5, 8–9_

- [x] 4. Update CRM Knowledge MCP and local Skill contract
  - Generate GPT summary from stored system original only, directly save GPT summary, and report completion.
  - Preserve tool/server names and OAuth permissions; update descriptions and the user Skill instructions.
  - _Requirement: 6, 8_

- [x] 5. Add paired migration/rollback and contract regression
  - Replace the public RPC definition without dropping existing objects or changing stored command rows.
  - Cover stale writes, no-review direct save, legacy pending rows, worker completion, and MCP behavior.
  - _Requirement: 4–9_

- [x] 6. Verify, deploy, and reconcile all three endpoints
  - Run approved regression/release gates; deploy only touched assets/functions and apply only the paired public migration.
  - Confirm local, GitHub master/tag, and CloudBase source parity; record any unverified runtime paths.
  - _Requirement: 1–10_
