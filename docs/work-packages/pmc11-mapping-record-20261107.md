# Work package: PMC11 Person AI Gateway map

Date: 2026-11-07
Base: `769f8f8` (`release-20261107-040917`)
Scope: map old AI entry points to current Person AI Gateway behavior and existing automated assertions.

## Changes

- Added [`pmc11-person-ai-gateway-mapping-20261107.md`](./pmc11-person-ai-gateway-mapping-20261107.md) with caller/action, identity, persistence, Gateway counterpart, human boundary, compatibility, and evidence status for the legacy AI paths found in source.
- Updated [`pmc11-identity-migration.md`](../../tests/pmc/pmc11-identity-migration.md) to link the inventory and document why the PMC11 TODO remains open.
- No runtime code, UI, Cloud Function, route, database object, configuration, or production data changed.

## Compatibility and risk

This is a documentation-only audit. It neither routes old calls into `assistant` nor changes their output, authorization, persistence, or fallback behavior. Existing admin and Console flows remain unchanged. Repository search cannot prove the absence of CloudBase manual/external callers; the inventory says so explicitly.

## Verification

Targeted tests were run against the Gateway and adjacent legacy identity contracts:

| Command | Result |
| --- | --- |
| `npm run test:pc20` | 5 passed, 0 failed |
| `npm run test:pc23` | 15 passed, 0 failed |
| `npm run test:pc29` | 12 passed, 0 failed |
| `node --test tests/pc33/*.test.cjs tests/pc33/*.browser.cjs tests/pmc/pmc12-recruit.test.cjs tests/pmc/pmc11-identity.test.cjs` | 27 passed, 0 failed, 1 TODO |

PMC11 TODO is intentionally preserved. It represents unresolved endpoint-wide migration/compatibility coverage and is not counted as a pass.

The required WP01 release gate did not pass, so this package was not committed, tagged, pushed, or deployed. Under Node 26, the PC34 service-role check crashed inside the installed CloudBase CLI. Retrying with the preinstalled Node 24 runtime cleared that CLI crash, but isolated browser checks then hit intermittent CDP failures in WP05 and WP02 on separate attempts. No failure points to a behavior regression in this documentation-only package; however, the repository release rule requires a passing gate, so publication remains blocked pending a clean gate run.

## Rollback

Revert this package's two documentation files. No cloud deployment or database rollback is required.

## Remaining work

- PMC11 does not prove every legacy endpoint is migrated or intentionally retained.
- Active Legacy callers and unknown external consumers require per-endpoint decisions before any runtime cleanup.
- Continue with the planned read-only admin/Console consumer matrix; do not remove old UI, routes, Cloud Functions, or schema objects without the required specific approval.
- Rerun WP01 release gate and publish this documentation package only after it passes.
