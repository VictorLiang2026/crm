# CRM Assistant private plugin package — 2026-11-06

## Scope

- Package the existing CRM Knowledge MCP endpoint as a private plugin displayed as **CRM Assistant | CRM 助手**.
- Bundle the existing `update-gpt-followup-advice` and `update-knowledge-gpt-summary` workflows.
- Keep the current MCP endpoint, function names, tool names, OAuth server, CRM routes, database schema, and existing connection intact.
- Request `knowledge:read` and `followup:read` as base scopes; offer `knowledge:gpt:submit` and `followup:gpt:submit` as default additional scopes. Do not request `followup:gpt:direct_write` by default.
- The follow-up advice Skill uses server preview and explicit per-record confirmation. It never calls the direct-write tool.
- No general customer, activity, recruitment, or arbitrary CRUD permissions are added.

## Impact and compatibility

- A new private ChatGPT/Codex plugin entry is additive. The old `CRM Knowledge` connector remains usable; its OAuth grants are not transferred to the new plugin connection.
- Users complete CRM OAuth once for this plugin's default scopes. The CRM consent page and server validate the user, scope, and each operation. Actual user authorization is still required after installation.
- Existing GPT follow-up preview/confirm, knowledge-summary, and separately scoped direct-write MCP tools remain available. The packaged follow-up Skill selects preview/confirm only.
- No CRM business record, permission policy, database object, or CloudBase function changed in this package.

## Package contents

- `plugins/crm-assistant/plugin.json`
- `plugins/crm-assistant/mcp.json`
- `plugins/crm-assistant/skills/update-gpt-followup-advice/SKILL.md`
- `plugins/crm-assistant/skills/update-knowledge-gpt-summary/SKILL.md`
- `plugins/crm-assistant/README.md`

## Verification

- Baseline: local HEAD, GitHub `master`, and release tag `release-20261106-113605` point to `60ba8c884b9e8d36a10aa964bb998301a0d76a90`.
- `tools/sync-check.ps1 -CloudOnly`: CRM page HTTP 200 and matching SHA-256; 96 static assets and 30 configured CRM functions / 243 source and config files match. The check did not access `pr_*` functions or schema.
- Existing MCP/OAuth regression: `node --test tests/knowledge-mcp/*.test.cjs` — 28 passed, 0 failed.
- Plugin JSON, skill frontmatter, OAuth endpoint, and scope package check — passed.
- Public OAuth protected-resource and authorization-server metadata were fetched successfully and advertise the package scopes plus the separately available direct-write scope.
- No live MCP OAuth grant, real Person write, or knowledge-summary write was attempted. OAuth consent and end-to-end use must be completed by the user in the host after plugin creation.

## Cloud and data changes

- CloudBase functions, static files, database schema/data, CloudBase permissions, and routes: unchanged.
- New private plugin publication is handled by Plugin Creator and uses the existing HTTPS MCP endpoint.
- Private plugin: `CRM Assistant | CRM 助手`, ID `plugins_6aed65a0aee88191bfabb320967c89aa`, release `pluginrel_6aed65a293848191b25c43951ed9897a`, version `0.1.0`, personal scope. Plugin URL: `https://chatgpt.com/plugins/plugins_6aed65a0aee88191bfabb320967c89aa`.

## Rollback

- Do not authorize the new plugin, or disconnect/uninstall its app connection if already installed; continue using the existing `CRM Knowledge` connection.
- Revert this package in Git and publish the normal recovery tag. No CRM data or schema rollback is required.
- OAuth grants for the new client, if later issued, must be revoked through the CRM OAuth revoke flow before retiring that connection.
