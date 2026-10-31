# CRM Knowledge MCP OAuth implementation

Status: `20261031120000` public-schema migration applied; required secret variables are present; `assistant` and corrected `knowledge_mcp` are deployed; bilingual consent assets uploaded. The pathful OAuth metadata endpoint works. No-write probes now pass for rejected callbacks, unsupported token grants, and unauthenticated MCP. A fake-client authorization probe reaches the assistant, but its signed internal assertion is rejected as `UNAUTHORIZED`; the HMAC configuration must match exactly in both functions or the bridge has another runtime issue. All OAuth/MCP business routes remain disabled. No GPT knowledge content has been generated or written.

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

Required secret configuration has been set directly in CloudBase; values were not read back or recorded. The anonymous function policy is limited to exact OAuth/MCP paths, methods, and the CRM HTTPSERVICE host, and denies all other anonymous function calls. Both OAuth discovery routes are enabled and the bilingual consent page and modules are hosted. A temporary no-write registration probe found that `fail()` returned instead of throwing; the code fix is deployed and the corrected invalid-callback test now returns 400. Unsupported token grants return 400 and unauthenticated MCP returns 401 with the resource challenge. All business routes have been restored to disabled. The fake-client authorization probe is read-only and reaches the assistant, but the assistant returns `UNAUTHORIZED` for the signed assertion; verify the identical `CRM_KNOWLEDGE_MCP_HMAC_KEY` value is set in both `assistant` and `knowledge_mcp`, then repeat this probe. Keep all business routes disabled until the bridge test passes, followed by interactive login, service-runtime, and live-write checks.

The metadata routes are safe discovery endpoints. The intentionally disabled root `/.well-known/oauth-authorization-server` route still fails under CloudBase's root well-known handling; the configured pathful endpoint is the supported issuer path for this deployment. Do not enable business/token routes as part of the source release.

## Rollback

Disable/remove the `/mcp/knowledge` route first, revoke OAuth grants, then deploy the previous `assistant` function and remove the `knowledge_mcp` function. Apply the paired SQL rollback only after the route is disabled and token revocation is complete. The consent page may remain statically hosted without granting access.

## Verification status

- Latest WP01: `PASS_WITH_LIMITATIONS`, 1,239 catalog checks, anonymous probe 81/81, regression fixture 108 pass/0 fail/5 skip, no blockers. Remaining open items are interactive login, service-runtime, live writes, and mobile (outside this iPad-only scope).
- Focused tests after the error-handling fix: MCP 7/7, security 6/6, and knowledge library 65/65. Full WP01: `PASS_WITH_LIMITATIONS`, 1,239 catalog checks, anonymous probe 81/81, regression fixture 108 pass/0 fail/5 skip; open items are login, service-runtime, live-writes, and mobile.
- Static checks: `node --check` passed on the changed Node files, `git diff --check` passed, and `npm run check:release-gate` passed.
- Live read-only check: both metadata routes are enabled; `/mcp/knowledge`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, and `/oauth/revoke` are disabled. Per-route QPS limits are configured. The anonymous policy matches only exact methods/paths on the CRM HTTPSERVICE host and denies other anonymous function calls. The fake-client authorization probe reaches `assistant`, but it rejects the signed assertion with `UNAUTHORIZED`; HMAC agreement remains unverified.
- The `20261031120000` migration is applied. Public-only catalog verification confirmed both tables, forced RLS, service-only policies, and both routines. No OAuth token exchange, consent login, GPT generation, or pending-review write has been run.
- An early rejected-callback probe was malformed JSON and exposed a non-throwing error helper; the fix is deployed. Repeated correctly serialized probes return 400 for an invalid callback, 400 for unsupported token grant, and 401 plus a bearer challenge for unauthenticated MCP. A read-only fake-client authorization attempt reaches the assistant but fails assertion verification with `UNAUTHORIZED`, so exact HMAC-key agreement must be checked before any live OAuth use. All business routes are disabled. No Git commit/tag/push has occurred for this final fix; no OAuth client, token, knowledge, or GPT data was written.
