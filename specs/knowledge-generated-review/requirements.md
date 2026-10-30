# Knowledge generated-content review requirements

## Goal

Every automatically generated knowledge result must remain outside AI retrieval until a person reviews it. Keep the last approved content available while edits or regeneration are pending.

## Scope

- File/image extraction results and AI-generated summaries are pending until a person approves the source/item.
- Content-version edits, restores, and regenerated candidates create a durable pending revision. The active revision remains readable by existing consumers until approval.
- Reviewers can approve or discard a pending revision. They can edit or regenerate through the existing content panel; source files remain unchanged when text is cleared or discarded.
- Approval, deletion, and application remain server-side, actor-bound, expected-version checked, and preview/confirm gated.
- Existing approved and manually managed records remain readable. Legacy entry flows remain available.
- UI text is bilingual through `t()` and iPad-first.

## Acceptance

1. Upload/extraction and AI summary generation do not activate generated text automatically.
2. Pending content is excluded from the shared knowledge resolver and downstream AI context.
3. Existing active content remains available while a replacement awaits approval.
4. A reviewer can inspect, approve, discard, edit, clear, and regenerate content; stale source/content versions cannot be approved.
5. Public-schema migration has a rollback; old RPC/table/function names remain.
6. Knowledge, retrieval, governance, and adjacent CRM regression is recorded before release.
