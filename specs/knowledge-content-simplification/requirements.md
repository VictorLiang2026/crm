# Knowledge Content Simplification — Requirements

## Scope

Simplify the knowledge content editor and its server path to generation, editing, clearing, and direct saving. Apply to `knowledge_items` and `playbooks` through the existing CRM assistant/RPC boundary. System content and GPT summaries become usable immediately after a successful save; content-level review is removed. Existing knowledge item/source lifecycle verification remains unchanged.

## Acceptance criteria

1. When a user opens Basic Information, the system and GPT summaries shall appear side by side and the system original shall span the same combined width below them.
2. When a user opens Content Confirmation on iPad, the two summaries shall appear side by side, the system original shall span both columns, and the sheet shall be 20% wider than the current 940px width, subject to viewport margins.
3. The editor shall provide direct Save, clear-summary/original/pair, and system original/summary regeneration actions. It shall not display preview submission, approval, adoption, candidate editing, manual progress refresh, or retry controls.
4. When the user saves or clears content, the service shall validate the exact record ID and expected `updated_at`, then persist directly without creating a review candidate or content-history command.
5. When a system-content regeneration job finishes, the worker shall write the result directly after rechecking the record version. Long attachment/PDF extraction may keep its internal worker queue; the editor shall not display queue progress or candidate content.
6. When the CRM Knowledge MCP generates a GPT summary, it shall use the stored system original, save only the GPT summary directly, preserve the system fields, and return a completed/saved result. Existing MCP server, Cloud Function, RPC name, tables, and routes shall remain present.
7. Existing command/history rows, including the K-11 pending GPT candidate, shall remain unchanged by deployment. New saves shall not be blocked by legacy pending-review rows.
8. The implementation shall retain bilingual labels, AI Gateway routing, OCR/attachment behavior, source relationships, and current content-read semantics; successful complete direct saves shall mark the saved pair usable without a separate content review action.
9. Database changes shall be public-only, use a migration and rollback, and shall not drop or rename any existing object.
10. iPhone behavior shall not be redesigned or removed in this work package.

## Regression scope

Direct edit/clear/save, stale-version rejection, GPT summary-only writes, asynchronous text/PDF regeneration, knowledge list/detail reads, effective-content projection, MCP read/write authorization, and existing source/OCR workflows.

## Non-goals

- No changes to knowledge item/source lifecycle verification.
- No deletion of existing tables, functions, RPCs, routes, grants, or stored history.
- No automatic mutation of existing pending/rejected/preview command rows.
- No change to AI model vendor/configuration or OCR ownership.
