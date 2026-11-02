# Knowledge GPT summary-only workflow — 2026-11-02

## Scope

Codex now reads only stored system text, generates only the GPT summary through the configured AI Gateway, and submits a version-checked candidate as `pending_review`. CRM background extraction/OCR remains unchanged. The knowledge UI and bilingual consent page no longer expose GPT-original text or attachment-read scope. The Skill instructions were updated at `C:\Users\victor\.codex\skills\update-knowledge-gpt-original-summary\SKILL.md`.

## Production data and permissions

- Applied public migration `20261102100000_knowledge_summary_only`; paired rollback is in the migration directory and mirror.
- Removed `gpt_original_text` from `public.knowledge_items` and `public.playbooks`; no rows select GPT content or retain `content_state.gpt.text`.
- K-11's existing GPT summary candidate remains pending review. The historical GPT-original snapshot key was removed; the command row, summary and pending status were retained. The summary was not approved or published.
- Persisted OAuth grant scope is now only knowledge read and GPT-summary submit. The grant row, refresh family and all three client registrations remain. No authorization code or attachment-read scope remains. Its short access token had expired; the refresh credential was still within expiry at verification.
- The legacy GPT queue routine is retained for compatibility, but execution is revoked and the assistant RPC allowlist no longer calls it.

## Deployment

- CloudBase functions deployed: `assistant`, `person_360`, `knowledge_mcp`.
- Static files deployed individually: `/crm/oauth-consent.html`, `/crm/js/modules/console/i18n.js`, `/crm/js/modules/console/knowledge-content.js`, `/crm/js/modules/console/knowledge-governance.js`, `/crm/js/modules/console/knowledge-mcp-consent.js`.
- No `pr` schema or `pr_*` function was queried, called, changed, or deployed.
- Online OAuth metadata returns only `knowledge:read` and `knowledge:gpt:submit`. `sync-check.ps1 -CloudOnly` passed: 30 CRM functions / 243 source and config files, 96 reachable static assets, and the unchanged `admin.html` hash.
- CloudBase AI remains on the existing resource-point plan and configured gateway. No extra Token Credits package was purchased and no live model generation was run during this release.

## Verification

- Focused summary/MCP/review tests: 35 passed.
- WP01: `PASS_WITH_LIMITATIONS`; 108 regression cases passed, 5 historical skips, 81 anonymous checks passed, catalog and identity audits passed. Remaining declared gaps: manual login, service-runtime/write probe, real live writes/AI and mobile visual acceptance.
- Full `test:knowledge-library` attempt: summary and OCR cases passed, but six PDF rendering cases could not load `@napi-rs/canvas` in the isolated worktree. No package was installed or changed.
- Authenticated CRM MCP read and summary submission were not invoked from this session; no candidate was approved or published.

## Rollback

The paired rollback restores nullable GPT-original columns and the prior RPC shape. It cannot reconstruct the GPT-original snapshot text removed from the K-11 pending command; its GPT summary and `pending_review` state remain. Before rollback, inspect any newer pending commands. Restore old source-read grant scope only if that capability is separately required and reviewed.
