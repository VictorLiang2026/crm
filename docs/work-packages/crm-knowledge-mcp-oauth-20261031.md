# CRM Knowledge MCP OAuth implementation

Status: `20261031120000` public-schema migration applied; required secret variables are present; the user confirmed the two `CRM_KNOWLEDGE_MCP_HMAC_KEY` values match and are saved; updated `assistant` and `knowledge_mcp` are deployed; bilingual consent assets uploaded. The pathful OAuth metadata endpoint works. No-write probes reject invalid callbacks, unsupported token grants, and unauthenticated MCP. A signed fake-client authorization probe reaches the public OAuth RPC and returns the expected 400 `invalid_client`. Per the user's request to proceed with interactive connector authorization, all OAuth/MCP business routes are now enabled with configured per-IP QPS 10 / total QPS 100. The user must create the ChatGPT custom MCP app and complete CRM login/consent. The actual ChatGPT DCR, token exchange, and pending-review write have not yet run.

## Scope

- Adds a separate `knowledge_mcp` CloudBase function and `/mcp/knowledge` HTTP route contract.
- Adds OAuth 2.1 authorization code with PKCE, restricted dynamic client registration for ChatGPT callback URLs, rotating hashed tokens, audience and scope checks, token revocation, and RFC 9207 issuer response parameters.
- Adds `crm/oauth-consent.html`, which reuses the CRM CloudBase browser session and the existing five-minute activity timeout. Consent copy is bilingual.
- Adds a signed, short-lived internal assertion accepted only by the `assistant` knowledge-only bridge.
- Adds a version-checked GPT generation queue for `knowledge_items` with one explicit `source_id`. The worker reads that exact linked source, creates a GPT-only preview, applies it as `pending_review`, and verifies the pending candidate by its generated command ID. Playbooks and rows without a unique direct source are read-only and fail closed for generation. It never approves or activates content.
- Database work is limited to `public`; migration and rollback are paired.

## Function configuration requirements

The following values must be set in CloudBase function configuration, not committed to source:

| Variable | Function | Purpose |
| --- | --- | --- |
| `CRM_ASSISTANT_DB_API_KEY` | `assistant` | Existing server-only public-schema API key; MCP OAuth data operations are handled by the assistant's fixed RPC allowlist |
| `CRM_KNOWLEDGE_MCP_HMAC_KEY` | both functions | Random secret of at least 32 characters for the private assistant bridge |
| `CRM_KNOWLEDGE_MCP_CLOUDBASE_API_KEY` | `knowledge_mcp` | Dedicated server API key mapped to `service_role` (bypasses RLS); MCP code uses it only to invoke the fixed `assistant` bridge, never for database calls |
| `CRM_KNOWLEDGE_MCP_RESOURCE_URL` | both functions | Canonical HTTPS MCP resource URL |
| `CRM_KNOWLEDGE_MCP_ISSUER_URL` | both functions | Canonical HTTPS HTTPSERVICE origin (no path or trailing slash); code derives the `/knowledge-mcp` issuer path |
| `CRM_KNOWLEDGE_MCP_CONSENT_URI` | `knowledge_mcp` | HTTPS URL of `/crm/oauth-consent.html` |

The verified default HTTPSERVICE domain is `https://crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com`. The required metadata paths are `/.well-known/oauth-protected-resource/mcp/knowledge` and `/.well-known/oauth-authorization-server/knowledge-mcp`; other routes are `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, and `/mcp/knowledge`, all routed to the isolated HTTP Function with path transmission enabled. The root `/.well-known/oauth-authorization-server` route was tested and returns CloudBase `INVALID_ENV`; it remains disabled. The pathful issuer follows RFC 8414's issuer-with-path discovery rule. Consent uses the existing static domain. The API key is `service_role`, cannot be platform-scoped to one function, and must be treated as an elevated server secret. The MCP function code uses it only for the fixed assistant bridge; the HMAC assertion and assistant operation allowlists enforce the application boundary.

## Required deployment checks

Before exposure, verify the HTTP Function runtime and route support, keep global gateway authentication disabled while limiting public invocation to this one function, apply per-IP and total route QPS limits including DCR, and confirm current quotas/pricing for HTTP, function invocations, OCR, and AI. Deploy only the migration, `assistant`, `knowledge_mcp`, the consent page, and its module/i18n files.

## Release state

Required secret configuration is set directly in CloudBase; secret values were not read back or recorded. The user confirmed the HMAC value is identical in both functions. The anonymous function policy is limited to exact OAuth/MCP paths, methods, and the CRM HTTPSERVICE host, and denies all other anonymous function calls. Both OAuth discovery routes are enabled and the bilingual consent page and modules are hosted. A temporary no-write registration probe found that `fail()` returned instead of throwing; the fix is deployed and invalid callbacks return 400. Unsupported token grants return 400 and unauthenticated MCP returns 401 with the resource challenge. Canonical JSON signing, payload hashing, and verification are deployed to both functions. A read-only nonexistent-client authorization probe returned 400 `invalid_client`, proving the HMAC bridge and database client validation work. For the user's requested interactive authorization, the five business routes are enabled with per-IP QPS 10 / total QPS 100. The user must now create the ChatGPT custom MCP app and finish CRM login/consent; actual DCR, token exchange, and pending-review write verification are still outstanding.

The assistant maps the allowlisted OAuth RPC error codes to fixed application errors without returning database response details. The MCP HTTP layer maps both legacy and `MCP_` client errors to OAuth `invalid_client`.

The metadata routes are safe discovery endpoints. The intentionally disabled root `/.well-known/oauth-authorization-server` route still fails under CloudBase's root well-known handling; the configured pathful endpoint is the supported issuer path for this deployment. The business routes have since been enabled for the requested interactive connector flow, separately from this source-only release.

## Existing deployed frontend baseline

The current CloudBase static host has three source files that differ from the checked-out release base: `crm/js/modules/console/i18n.js`, `crm/js/modules/console/knowledge-pdf-upload-worker.js`, and `crm/js/modules/console/knowledge-pdf-upload.js`. The i18n file contains already-live follow-up-advice labels and PDF volume text, and the PDF modules contain the deployed 40-page volume behavior. Per the selected preservation plan, these exact live files are included in GitHub source so publishing OAuth cannot overwrite them. This is a source-baseline sync only; these files are not uploaded or otherwise changed in CloudBase.

## Rollback

Disable/remove the `/mcp/knowledge` route first, revoke OAuth grants, then deploy the previous `assistant` function and remove the `knowledge_mcp` function. Apply the paired SQL rollback only after the route is disabled and token revocation is complete. The consent page may remain statically hosted without granting access.

## Verification status

- Latest WP01: `PASS_WITH_LIMITATIONS`, 1,239 catalog checks, anonymous probe 81/81, regression fixture 108 pass/0 fail/5 skip, no blockers. Remaining open items are interactive login, service-runtime, live writes, and mobile (outside this iPad-only scope).
- Focused tests after the canonical payload and error mapping fixes: MCP 7/7, security 6/6, knowledge library 65/65, AI Gateway 18/18, and AI skills 11/11. Full WP01: `PASS_WITH_LIMITATIONS`, 1,239 catalog checks, anonymous probe 81/81, regression fixture 108 pass/0 fail/5 skip; open items are login, service-runtime, live-writes, and mobile.
- Static checks: `node --check` passed on the changed Node files, `git diff --check` passed, and `npm run check:release-gate` passed.
- Live read-only check: both metadata routes and `/mcp/knowledge`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, and `/oauth/revoke` are enabled; each route has QPS total 100 / per client IP 10. The root discovery route remains disabled. The anonymous policy matches only exact methods/paths on the CRM HTTPSERVICE host and denies other anonymous function calls. A temporary `/oauth/authorize` probe using a nonexistent client returned HTTP 400 `invalid_client` before the route was enabled for the requested interactive flow.
- The `20261031120000` migration is applied. Public-only catalog verification confirmed both tables, forced RLS, service-only policies, and both routines. No OAuth token exchange, consent login, GPT generation, or pending-review write has been run.
- An early rejected-callback probe was malformed JSON and exposed a non-throwing error helper; the fix is deployed. Correctly serialized probes return 400 for an invalid callback, 400 for unsupported token grant, and 401 plus a bearer challenge for unauthenticated MCP. Canonical payload signing is deployed; the read-only fake-client request now passes assertion verification, reaches OAuth RPC, and returns `invalid_client`. All authorized business routes are now enabled for the user's interactive connector flow; no actual OAuth client, token, knowledge, or GPT data was written yet.
- `sync-check.ps1 -CloudOnly` previously passed after the canonical-payload deployment: 96 page assets and 244 source/config files across 30 functions matched CloudBase. It then detected the three pre-existing static-baseline differences recorded above. The live files were captured for source-only synchronization; rerun the complete check before the Git release commit, tag, and push.
