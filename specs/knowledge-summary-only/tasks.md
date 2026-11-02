# Implementation Plan

- [x] 1. Reconcile and record a clean release baseline
  - Compare GitHub master, current CRM branch/worktree, OAuth feature worktree, and production assets/functions.
  - Isolate this work in a clean worktree; preserve unrelated `person_followup_advice` changes.
  - _Requirement: 1, 11_

- [x] 2. Refactor the CRM Knowledge MCP contract to text-only reads
  - Return system original text and summary/status metadata by exact table and record ID.
  - Remove source-file scope requirements and ensure no tool exposes attachment bytes or URLs.
  - Support knowledge items and playbooks.
  - _Requirement: 2, 7, 10_

- [x] 3. Implement summary-only pending generation
  - Read only `content` or `response_logic` from the exact record, version-check, call configured AI Gateway, and create only a GPT-summary candidate.
  - Keep pending-review, duplicate-pending, failure, and status behavior; do not activate content.
  - _Requirement: 3–7_

- [x] 4. Remove GPT-original fields from public service and UI contracts
  - Update assistant and person_360 shared projections, management DTOs, previews, knowledge editing UI, and bilingual i18n strings.
  - Keep GPT-summary review/edit/approve behavior and system OCR/source workflows.
  - _Requirement: 8_

- [x] 5. Create and apply the public-schema migration pair
  - Guard against non-empty GPT-original column or content-state data; strip GPT-original from command snapshots while retaining summaries and pending review.
  - Update both public content RPC routines and confirm no dependent public views remain.
  - Add rollback SQL and migration copies required by the environment.
  - _Requirement: 8, 9_

- [x] 6. Narrow consent and preserve the Codex OAuth connection
  - Request knowledge read and GPT-summary submit scopes only.
  - Remove attachment-read scope from the retained grant while preserving all three registered clients and its refresh family; verify public OAuth metadata. Authenticated MCP read/generation is not verified in this session because no CRM Knowledge MCP caller is exposed here.
  - _Requirement: 10, 11_

- [x] 7. Run focused tests and regression
  - Cover summary-only output, version conflicts, duplicate pending candidates, approval, source/OCR compatibility, playbooks, public RPC output, and OAuth scopes.
  - WP01/release gate passed; deploy only the three affected CRM functions and five static files, then verify CloudBase source consistency. The full knowledge-library suite also hit six PDF-render test failures because the isolated worktree lacks `@napi-rs/canvas`; the summary/OCR compatibility tests and full WP01 suite passed.
  - _Requirement: 1–11_

## Release follow-up

The isolated implementation has been deployed and verified in CloudBase. GitHub master commit, release tag, and final three-way consistency check remain for release close-out.
