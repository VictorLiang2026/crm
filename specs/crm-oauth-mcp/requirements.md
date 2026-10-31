# CRM Knowledge OAuth/MCP Requirements

## Problem

Codex Skill calls currently do not reliably carry the CloudBase user session held by Edge. The CRM `assistant` function requires a non-anonymous CloudBase caller, so tool calls can return `UNAUTHORIZED` even while the CRM page is signed in.

## Scope

- Add a remote MCP connection for Codex, authenticated through OAuth 2.1 authorization code with PKCE.
- Reuse the existing CRM CloudBase account and sign-in state for the authorization page where available.
- Limit the connection to knowledge-library read, linked-source read/OCR, GPT generation, preview, and write-as-pending-review operations.
- Automatically submit a generated and validated GPT candidate as `pending_review`; never approve, publish, or activate it.
- Preserve the current `admin.html` sign-in, five-minute idle reauthentication, `callFn` data boundary, and existing CRM operations.
- Keep all database work in `public`; any new database object requires an additive migration and rollback.
- Keep Chinese and English consent UI strings in the existing i18n dictionary. Design only for iPad.

## User stories

1. As a CRM user, I can authorize Codex once and use the knowledge Skill without relying on Edge's local browser session being forwarded to management tools.
2. As a CRM user, I can revoke the Codex connection and know that an expired or revoked token cannot read or write knowledge records.
3. As a CRM user, I can have missing GPT content prepared and written as a pending-review candidate without changing active system content or approving it.

## Acceptance criteria (EARS)

- When a user starts OAuth authorization, the system shall validate the registered client, exact redirect URI, state, and PKCE challenge before issuing an authorization code.
- When the authorization page is opened in an authenticated CRM session, the system shall identify the caller from CloudBase auth, display the requested narrow scopes, and never accept a caller-supplied CRM UID.
- When an access token is missing, expired, revoked, malformed, or missing a required scope, the MCP endpoint shall reject the request and expose an OAuth authentication challenge without disclosing credentials.
- When a token is valid, the MCP server shall expose only knowledge-library tools and shall bind each operation to the CRM UID in the verified token.
- When an OAuth access token is used, the server shall bind it to the registered MCP resource/audience and reject tokens issued for another resource.
- When a client is dynamically registered, the server shall accept only the explicitly allowed ChatGPT callback URI patterns and shall persist the client for later authorization checks.
- When GPT content generation succeeds and the exact record/source/version preflight passes, the server shall submit only missing GPT fields as `pending_review` and verify the pending candidate by record ID.
- The GPT generation operation shall accept only `knowledge_items` records with one directly linked source; unsupported or ambiguous record types shall fail closed.
- When OCR, source association, version checking, or generation fails, the server shall stop that record and leave active knowledge content unchanged.
- When a user revokes a connection or refresh-token rotation detects reuse, the server shall invalidate the associated token family.
- The system shall not expose an approval, publish, activation, generic database, arbitrary function, or arbitrary record-write tool through MCP.
- Existing CRM username/password login, five-minute idle reauthentication, and non-MCP `assistant` calls shall retain their current behavior.
- The authorization flow shall be bilingual (Simplified Chinese and English) and use the existing i18n `t(key)` dictionary.
- The knowledge scan shall report its scanned range and any list-cap limitation rather than claim full-library coverage without proof.
- The MCP server shall support current protocol discovery and negotiation while retaining the compatible legacy initialization flow.

## Non-goals

- Replacing CRM's current login provider or changing credentials.
- Connecting unrelated CRM functions or granting broad CRM read/write scopes.
- Automatic review approval, publishing, or business activation.
- Changes to `pr` schema, `pr_*` functions, or the unspecified preview environment.
- Mobile layout work.
