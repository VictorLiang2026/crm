# Knowledge GPT total summary release, 2026-11-13

## Scope and impact

- Extends the installed and repository `update-knowledge-gpt-summary` Skill for aggregate summaries on multi-volume knowledge documents.
- Adds read/list/get and GPT total-summary operations to the existing `assistant` and `knowledge_mcp` functions. Ordinary summaries retain their existing behavior; the ordinary path now refuses sources with any explicit volume marker.
- Uses the existing `public.knowledge_documents.gpt_summary`, `gpt_basis`, and `gpt_version` fields. No schema, permission, route, or environment-variable changes were made.
- Reads the current per-volume system originals from exact, server-validated `knowledge_items` IDs returned by `crm_knowledge_document_read_v1`. The document chunk table stores uploaded PDF bytes and is not used as summary text.
- Saves only to the exact aggregate document ID, binds the summary to the current basis, and checks both source basis and GPT version before writing. Existing summaries are skipped.

## Baseline and deployment

- Rebased the isolated worktree onto GitHub `master` `572abb1892d3cdeb9e26a5450970395f3385618d`.
- Before deployment, the online `admin.html` SHA-256 matched current GitHub `master`. Downloaded production source archives for `assistant` and `knowledge_mcp`; all 52 and 4 root JavaScript/package files respectively matched current `master` after normalizing line endings.
- Deployed only CloudBase functions `assistant` and `knowledge_mcp` in `crm-d1gkae8ddc930d151`, after shared-source checks and WP01 release gate.
- No page, database migration, other function, route, or permission was deployed or changed.

## Validation

- Targeted knowledge/MCP regression: 24 passed.
- Syntax checks and `git diff --check`: passed.
- WP01: `PASS_WITH_LIMITATIONS`; 1,547 catalog checks passed, 106/106 anonymous checks passed, WP04 identity audit passed, PC34 service-role read-only check passed, and the isolated regression passed 102 with 0 failures and 5 documented skips.
- Remaining standard WP01 limitations: no manual login probe, production writes, or mobile acceptance were performed.
- After deployment, the authorized CRM Knowledge MCP `knowledge_records_list` read returned `ok=true` with page coverage, confirming the existing OAuth endpoint remained operational. The new tools require clients to refresh their MCP tool list before they appear in the current desktop session.

## Recovery

- Restore the two deployed functions from the immediately preceding production source baseline, which matched GitHub `master` `572abb1` before this change.
- No database rollback is needed.
