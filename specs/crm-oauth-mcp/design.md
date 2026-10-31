# CRM Knowledge OAuth/MCP Design

## Baseline facts

- CRM Web uses CloudBase username/password authentication with local browser persistence; the page asks users to sign in again after five minutes idle.
- `assistant` currently obtains identity from `@cloudbase/node-sdk` `auth().getUserInfo()` and rejects missing or anonymous callers.
- CloudBase configuration has username/password enabled; the custom OAuth provider is off. The default HTTP gateway is enabled, global gateway auth is off, and there is no custom domain. The static-host domain routes to static hosting; the default HTTPSERVICE domain has no routes yet. The environment is on the Personal plan.
- Existing knowledge content APIs already support stable-ID detail, source extraction/OCR, GPT-target preview, and a server-side apply that creates `pending_review` without activating content.

## Proposed boundaries

1. **Authorization page:** Add a consent route to the CRM console as a module under `crm/js/modules/console/`. Reuse the existing authenticated CloudBase browser session when present. Use `t(key)` from `crm/js/modules/console/i18n.js`; if the session is missing, use the existing CRM sign-in flow. Show only the requested knowledge scopes.
2. **OAuth/MCP HTTP endpoint:** Add a dedicated CloudBase HTTP Function for OAuth metadata, authorization-code/token/revocation endpoints, and the remote MCP endpoint. Use OAuth 2.1 authorization code + PKCE, short-lived access tokens, rotating refresh tokens, resource/audience binding, exact redirect-URI allowlisting, and token revocation. Keep the endpoint narrow; do not reuse a general-purpose admin API. Support current MCP discovery/negotiation plus the compatible legacy initialization flow. CloudBase reserves the root `/.well-known/oauth-authorization-server` path; derive the standards-based issuer `https://<HTTPSERVICE-domain>/knowledge-mcp` from the configured origin and publish its RFC 8414 discovery document at `/.well-known/oauth-authorization-server/knowledge-mcp`.
3. **Trusted identity bridge:** The HTTP Function verifies OAuth access tokens and scopes. Calls into the existing knowledge service must carry a server-signed, short-lived identity assertion; the CRM UID comes only from the verified OAuth grant, never tool arguments. The `assistant` entry point shall accept this assertion only on a dedicated knowledge-only internal action and only after signature, audience, expiry, and scope checks. Existing CloudBase-authenticated routes stay on their current path.
4. **OAuth storage:** Add a `public`-schema table for hashed authorization codes and refresh-token families, with expiration, revocation, client, user, and scope fields. Enforce RLS and grants for server-only access. Add both forward migration and rollback. Store no raw refresh tokens or private signing keys in the database.
5. **Knowledge workflow:** The MCP generation tool reads the exact linked source by record ID, performs OCR/extraction, generates only missing GPT fields through the existing AI Gateway selection, creates a `target: gpt` preview, applies the existing pending-review workflow, and verifies the record/version/status. It accepts only `knowledge_items` with one directly linked source and must not apply the current system-target regeneration preview. Other record types remain read-only where supported.
6. **Tool allowlist:** Expose only bounded list/detail/source-read/generate-and-submit-pending/status/revoke operations. Do not expose approve, publish, arbitrary SQL, arbitrary CloudBase function invocation, or unrestricted `assistant` routing.

## Deployment and identity constraints

- The HTTP Function must use explicit server credentials from function configuration, never source or browser code. The configured issuer variable is the HTTPSERVICE origin; code derives the pathful issuer `/knowledge-mcp` for RFC 8414 discovery because CloudBase intercepts the root metadata path. Use a dedicated CloudBase server API key mapped to `service_role` and a dedicated HMAC signing key; the MCP function uses the API key only to invoke the fixed assistant bridge and does not receive the existing assistant DB key. Because this key bypasses RLS if leaked, document rotation/revocation and never return or log it.
- The function must reject public requests without a valid OAuth token except discovery, authorization, token, and revocation routes that require their respective protocol checks.
- Route exposure should use the existing default HTTPSERVICE domain if supported, with a dedicated `/mcp/knowledge` path and function security rule. The existing static route is not the MCP route. Do not enable global gateway authentication as a shortcut; enforce OAuth bearer tokens in this endpoint. Do not bind a new custom domain in this work package.
- No changes to the existing admin login provider, `ensureSession`, `callFn`, or `pr` resources.

## Compatibility and failure behavior

- Normal CRM users continue using the existing login and CloudBase `callFn` route.
- Codex calls are authenticated independently via the OAuth grant. Expired/revoked access returns a standards-based authentication challenge and cannot fall back to anonymous or management credentials.
- Every content write remains a pending-review candidate. Active system fields and selected content stay unchanged until the existing human review process runs.
- If OAuth identity mapping, authorization state, source linkage, or record version cannot be verified, fail closed and do not write.

## Verification and regression

- Unit/contract checks: OAuth state/PKCE/redirect URI, code single-use/expiry, token rotation/revocation, scope enforcement, HMAC assertion validation, and tool allowlist.
- Runtime verification: authorized caller can read a bounded knowledge record and create a pending GPT candidate; anonymous, expired, wrong-scope, forged-UID, and replay requests are denied.
- Business regression: CRM login/logout and five-minute reauthentication; knowledge list/detail/source read/OCR/GPT preview/pending review; verify no approval route exists. Check existing assistant authenticated operations remain unchanged.
- Verify database migration/rollback against `public` only and verify CloudBase/GitHub/local release consistency.

## Open deployment check

The environment currently has no custom domain and only a static-host route. Before public exposure, verify the default HTTPSERVICE domain and exact route capability, function security rules, API-key creation/permissions, and any platform cost. Stop before deployment if any required item cannot be confirmed.
