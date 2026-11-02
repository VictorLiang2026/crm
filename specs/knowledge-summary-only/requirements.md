# Knowledge GPT Summary Only — Requirements

## Problem and scope

Generate a GPT summary from the system's already stored original-text field. CRM background extraction/OCR remains responsible for turning uploaded files and images into that text. Codex reads record text fields only and submits a summary-only candidate for human review.

This work covers `knowledge_items` and `playbooks`, the CRM Knowledge MCP read/submit flow, server-side generation and pending-review commands, the knowledge content interface, and removal of the GPT-original field from the system. It does not change background OCR, attachment storage, source metadata, or unrelated CRM work.

## User story

As a CRM knowledge editor, I want Codex to summarize the system original text already stored in a knowledge record and save only the GPT summary as pending review, without reading the source file or creating a GPT original field.

## Acceptance criteria

1. When an authorized CRM Knowledge MCP session scans records, the system shall report complete pagination or clearly mark the scan partial.
2. When a candidate record is read, the MCP service shall return its stable ID, type, system original text, GPT summary, content version, and review status without exposing attachment bytes or requiring source-file read permission.
3. When a record's GPT summary is already populated or already pending review, the workflow shall skip it without overwriting or duplicating the candidate.
4. When a record lacks a GPT summary and has usable system original text, the assistant shall generate a summary solely from that text through the configured AI Gateway/model routing.
5. When system original text is absent, still being produced by background OCR, or the record version changes, the operation shall stop safely without reading the attachment or changing active content.
6. When generation succeeds, the service shall save only a version-checked GPT-summary candidate with status `pending_review`; human approval remains required before it becomes effective.
7. When a record type does not support summary-only generation, or the MCP surface would read an attachment, generate GPT original text, or directly change active fields, the workflow shall stop and report the limitation.
8. The CRM system shall no longer expose or persist a GPT-original field in `public.knowledge_items` or `public.playbooks`, their public RPC responses, management APIs, or knowledge editing UI.
9. Before dropping the GPT-original columns, the migration shall fail closed if non-empty values exist in either table column, either table's `content_state`, or if a row selects GPT original text. Old GPT-original text in content-command snapshots shall be removed while keeping each command, GPT summary, and review status. The migration shall be limited to `public` and include a rollback migration.
10. When the new consent flow is shown, it shall request only knowledge read and GPT-summary submission. It shall not request attachment/source-file read permission.
11. Existing OAuth client registrations and the active Codex grant shall remain registered and usable for the reduced scope. Remove `knowledge:source:read` from all persisted grants without revoking the active grant; retain `knowledge:read` and `knowledge:gpt:submit` when originally present. Expired authorization codes remain purged.

## Compatibility and regression scope

- Preserve the existing system-original and system-summary fields, OCR background workflow, GPT-summary review/edit/approve lifecycle, AI Gateway routing, and record ID/version checks.
- Remove only GPT-original behavior and its use as an AI retrieval source. Existing records currently select the system-original source; verify that condition again immediately before migration.
- Update `crm_knowledge_content_v1` and `crm_knowledge_content_snapshot_v1` with the schema migration; inspect public view dependencies before applying it.
- Regression must cover list/detail reads, summary-only generation, pending creation and status, stale-version and duplicate-pending handling, review and approval, source/OCR compatibility, playbooks, and authentication/scope enforcement.
- Do not use real customer records for destructive testing. Live verification must not approve or publish generated content.

## Explicit non-goals

- No GPT reading/downloading/OCR of files or images.
- No changes to system originals/summaries, OCR retry behavior, source records, storage objects, or attachment relationships.
- No automatic approval, publication, or activation of generated summaries.
- No cleanup or rewrite of unrelated CRM features or the unrelated pending `person_followup_advice` changes in the current checkout.
- No removal of the CRM Knowledge OAuth server, Codex client, or active Codex grant.
