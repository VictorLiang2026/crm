# Knowledge GPT Summary Only — Design

## Current implementation audit

- `public.knowledge_items` stores system original text in `content`; `public.playbooks` stores it in `response_logic`. Both tables currently contain `gpt_original_text`, `gpt_summary`, `selected_content_source`, and `content_state`.
- Read-only production counts on 2026-11-02: 11 `knowledge_items` and 1 `playbooks`; both tables have zero non-empty `gpt_original_text` and zero non-empty `gpt_summary`. All 12 rows select `original`. No row has a GPT text payload in `content_state`. One `knowledge_items` ID 11 pending-review command holds a 12,250-character GPT-original candidate and a GPT summary; migration removes only the GPT-original key and retains its summary and pending state.
- No public view or materialized view definition references `gpt_original_text`. Public routines `crm_knowledge_content_v1` and `crm_knowledge_content_snapshot_v1` do reference it and must be revised with the column migration.
- The current MCP tool `knowledge_generate_gpt_pending` is limited to `knowledge_items`, reads the linked attachment and may run extraction/OCR, and generates missing GPT fields. It is incompatible with this requirement and must not be called by the revised Skill until its behavior is changed.
- The MCP record detail currently requires `knowledge:source:read`. Summary-only record reads should require `knowledge:read`; generation should require `knowledge:read` and `knowledge:gpt:submit` only.
- OAuth audit: three registered Codex loopback clients and one active grant existed; 43 authorization-code grants were expired. The 43 expired rows were removed from `public.crm_knowledge_mcp_grants` on 2026-11-02. Post-write check found one active grant and no authorization-code rows. No ChatGPT callback client was present. Preserve the active grant and all three client registrations.
- The existing non-revoked grant contained `knowledge:source:read`. The migration removed that scope while preserving the grant row, its refresh family, all three client registrations, and read/submit capabilities. Post-migration, the refresh credential remains unexpired; the short-lived access credential had expired and can be refreshed. No persisted grant retains `knowledge:source:read`.
- Direct Codex OAuth login completed, but a later local MCP initialization attempt received HTTP 403 from a `chatgpt.com` account-link endpoint before any CRM tool call. This is not evidence that CRM rejected the token; the authenticated MCP data operation remains unverified. Recheck from the Codex app after the tool definition changes. Do not recreate the client or repeat OAuth unless CRM itself reports an authorization failure.

## Architecture and data flow

```text
CRM background extraction/OCR
        │ writes system original text
        ▼
CRM Knowledge MCP (read exact record ID + text fields)
        │ system original text + expected version
        ▼
Assistant service → configured AI Gateway → GPT summary only
        │ server-verified preview and version check
        ▼
Existing knowledge content command → pending_review
        │
        └─ human review remains the only activation path
```

Codex never opens a file, image, storage URL, or source byte stream. A missing system original means the OCR pipeline has not made usable text available; the record is reported and skipped.

## MCP/API changes

- Keep `knowledge_records_list`, `knowledge_record_get`, and `knowledge_generation_status` names and stable record IDs.
- Update record detail to return the text fields needed for summary generation and review classification, without source-file access. Support `knowledge_items.content` and `playbooks.response_logic` as system original text through a normalized response field.
- Rework `knowledge_generate_gpt_pending` to accept `knowledge_items` and `playbooks`, use the exact record ID and expected `updated_at`/content version, and generate only `gpt_summary`. Its server description must state that it uses stored system text and never reads files.
- Apply an explicit allowlist: list/detail require `knowledge:read`; summary submit requires `knowledge:read` plus `knowledge:gpt:submit`. Remove `knowledge:source:read` from consent, server metadata, new grants, and existing grants; do not expose a source-read tool.
- Continue to use OAuth PKCE, the existing CRM user session, the HMAC-protected assistant bridge, the public-schema RPC allowlist, and pending-review status. No new secret or identity bypass is introduced.

## Server and database changes

- Summary generation reads the current system original text by record ID inside the server service; it must not call `sourceBytes`, storage APIs, PDF/OCR helpers, or linked-source reads.
- Generate via configured AI Gateway capability; do not hard-code a model vendor. Validate output and create a GPT-summary-only candidate through the existing content command/preview path.
- Preserve current active system fields until a human approves the pending candidate. Version-check the record before and after generation; return an existing safe skip for an already pending candidate.
- Update both copies of shared content projection logic (`cloudfunctions/assistant` and `cloudfunctions/person_360`) and all assistant knowledge service projections to remove GPT-original reads/writes and previews.
- Remove the GPT-original column from both public tables in a migration. Raise an exception if any non-empty value exists in the columns or `content_state` GPT-text slot, and remove GPT-original keys from command snapshots while preserving GPT summaries and review state.
- Recreate `public.crm_knowledge_content_v1` and `public.crm_knowledge_content_snapshot_v1` without GPT-original fields. Confirm whether any other public routines, policies, triggers, or dependent views use the field; do not access any non-public schema.
- Provide a paired rollback that restores nullable columns and the former RPC shape. It also documents that GPT-original text stripped from the existing pending command cannot be reconstructed; the pending GPT summary and review state remain available.

## Applied production migration (2026-11-02)

- `20261102100000_knowledge_summary_only` is present in production migration history as the latest version. The migration service initially returned a false negative while history was still updating; a subsequent history/detail check and direct catalog/data checks confirmed completion.
- `gpt_original_text` is absent from both public tables. No rows select GPT content or retain GPT text in `content_state`.
- The K-11 pending command remains `pending_review`; its GPT summary is retained and its historical GPT-text key is empty. The command itself was not deleted or approved.
- Existing grant rows now contain only the allowed read/summary-submit scopes. One non-revoked grant and all three registered OAuth clients remain; there are no live authorization-code rows. Expired short-lived access can use the still-valid refresh credential.
- The service-only legacy queue routine remains present for compatibility but is no longer executable by `service_role` and is removed from the assistant RPC allowlist.

## UI changes

- Remove the GPT-original pane/editor and its Chinese/English labels from the knowledge content UI.
- Keep GPT summary display, edit, discard, preview, approval, and status behavior. Generated content stays visibly pending until approved.
- Preserve the bilingual `t(key)` pattern; do not add single-language hard-coded text.

## Rollout and verification

1. Reconcile the stale OAuth feature worktree and dirty main checkout against the current GitHub master and CloudBase baseline in an isolated worktree. Preserve unrelated `person_followup_advice` modifications; do not bulk merge or clean them.
2. Update and test assistant/backend code and OAuth contracts while the old columns remain present; deploy only the affected CRM functions and static assets.
3. Verify the summary-only read/preview/pending path with synthetic non-customer fixtures and the active MCP authorization. Confirm that no source/storage/OCR operation is called.
4. Confirm the migration data guard, exact public dependencies, paired rollback, and release gate. Then apply migration, verify public catalogs and RPC results, and deploy the updated UI.
5. Run targeted tests and cross-module regression for content generation/review, OCR/upload, retrieval selection, MCP scopes, and relevant public RPC callers. Record unverified login/runtime/write items rather than assuming they pass.

## Rollback

Disable the MCP submit route or revert its tool contract, deploy the previous assistant and front-end artifacts, and apply the paired public-schema rollback only after checking the state of any pending review commands. Rollback restores nullable GPT-original columns and old RPC output shape; no GPT-original data exists at migration time because the forward migration refuses to proceed otherwise. Preserve OAuth client registrations and the active grant throughout rollback.
