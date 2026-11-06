# CRM Knowledge MCP registration route repair

Date: 2026-11-06

## Scope

Restore the existing CRM Knowledge MCP OAuth discovery and dynamic registration endpoints. No gateway routes, OAuth scopes, client records, database objects, other functions, or `pr_*` resources were changed.

## Baseline

- GitHub `master` and the clean local release baseline: `60ba8c884b9e8d36a10aa964bb998301a0d76a90`.
- The `/oauth/register` and OAuth metadata gateway routes were already enabled and transmitted the full request path to `knowledge_mcp`.
- Before the fix, requests to the HTTP function failed during startup with `./scf_bootstrap: no such file or directory` (HTTP 443).

## Change

- Track `cloudfunctions/knowledge_mcp/scf_bootstrap` as executable and force LF line endings for that file.
- Add a regression assertion for the exact startup script bytes and Git executable bit.
- Redeploy only the existing `knowledge_mcp` function. Its existing OAuth issuer, scopes, and route configuration were preserved.

## Verification

- `node --test tests/knowledge-mcp/http-server.test.cjs`: 8 passed.
- `npm run build:shared` and `npm run check:shared`: 60 shared copies across 30 functions match.
- Downloaded deployed package inspection: `scf_bootstrap` present at package root, executable ZIP mode, exactly two LF bytes, no CR bytes.
- Live GET `/.well-known/oauth-authorization-server/knowledge-mcp`: HTTP 200, advertises `/oauth/register`.
- Live POST `/oauth/register` with a disallowed redirect URI: HTTP 400 from application validation; rejected before client registration storage.
- `npm run test:wp01`: `PASS_WITH_LIMITATIONS`; all critical checks passed, with existing manual login, service runtime, production writes, and mobile checks explicitly unverified.
- Full CloudBase/Git release parity: CloudOnly check is running before commit; post-release sync remains required.

## Recovery

If the route regresses, deploy the corrected `knowledge_mcp` package from the release commit. The pre-fix package produced HTTP 443 and is not a usable rollback target.
