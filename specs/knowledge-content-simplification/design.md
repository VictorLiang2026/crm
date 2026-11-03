# Knowledge Content Simplification — Design

## UI design specification

- **Purpose:** edit three stored text fields with a short, direct workflow.
- **Aesthetic:** industrial/utilitarian CRM console; reuse existing components and spacing.
- **Palette:** existing tokens `#D31145`, `#2E333B`, `#6B7280`, `#E7E9EE`, `#F5F5F7`.
- **Typography:** retain the existing CRM stack (`-apple-system`, PingFang SC, Segoe UI, Microsoft YaHei, sans-serif) as a narrow design-system override.
- **Layout:** iPad sheet width grows from 940px to `min(1128px, viewport - margins)`. System summary and GPT summary are equal columns on the first row; system original spans both columns below. Basic Information uses the same summary/original geometry. Each field group owns a compact action row; Save is the primary action, clear/regenerate actions are grouped by field. No new phone layout is introduced.

## Data flow

```text
Existing editor / CRM Knowledge MCP
        │ record ID + expected updated_at + field patch
        ▼
Existing assistant Cloud Function
        │ authenticated actor + validation
        ▼
Existing public.crm_knowledge_content_v1 RPC
        │ lock exact row, check version, update content_state / gpt_summary
        ▼
Existing content readers

System original regeneration: existing internal worker queue → extraction/OCR → summary → direct version-checked save
```

## Compatibility and persistence

- Keep the existing RPC/function/table/route names. Do not drop database objects or stored commands.
- Add direct `save` semantics to the existing public RPC. Keep worker-only `claim`/`progress` and `regenerate`; disable UI preview/apply/review/history operations from the application service.
- Direct saves update the current managed content state in place, increment its current revision token, and update `updated_at`; they do not append edit/history commands.
- Existing command rows remain inert and untouched. In particular, the live K-11 pending GPT candidate is not applied or deleted. New writes ignore legacy pending rows so they cannot block saves.
- Preserve item/source lifecycle statuses and current source validity checks. Remove only content-level `reviewed` gates.
- Keep the long-file worker internal because PDF extraction/OCR can span several pages. It writes finished output directly and keeps technical queue state, without exposing progress/candidate UI.
- Keep the existing GPT MCP tool name for registered clients; its behavior and description change from pending submission to direct GPT-summary save. The legacy status tool remains callable for compatibility but no new GPT job requires it.

## Migration and rollback

Create paired public-schema migration/rollback files. The migration replaces existing RPC behavior without dropping/renaming the function or command table. Rollback restores the prior SQL definition and leaves all command/history rows intact. No production record is changed by the migration itself.

## Validation

Run knowledge library service/browser tests, MCP contract/security tests, relevant assistant/person_360 projection tests, release gate, and CloudBase source sync. Browser verification covers iPad layout and direct-save flows in Chinese and English. Use only synthetic writes for regression; leave K-11 unchanged.
