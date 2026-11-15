# Person file import RPC allowlist fix — 2026-11-15

## Cause and change

Person file save, list, fetch and claim operations call the existing `public.crm_person_file_v1` RPC. The `person_360` function's `pgRpc()` allowlist omitted that RPC, so requests failed early with `Invalid RPC` and never reached the database. The RPC already exists and is restricted to `service_role`; no schema, data, permissions or other functions changed.

Added `crm_person_file_v1` to the `person_360` allowlist while retaining the legacy `crm_file_import_v1` entry. Added a regression assertion for both entries. Updated three older test harnesses so their fixtures use the current Console test helper and the `ai_parse` fixture supplies the required delegation wrapper; these changes affect test setup only.

## Scope and impact

- Deployed artifact: `cloudfunctions/person_360` only.
- Regression files: L04a PDF and L04b standalone Person file import, plus M08/M09 shared import harnesses.
- No database migration or rollback required; rollback is redeploying the previous `person_360` code from the baseline release tag.

## Verification

- WP01: `PASS_WITH_LIMITATIONS`; 1,551 catalog checks pass, anonymous probe 106/106, WP04 read-only identity audit passes, and all release-critical fixtures/regression pass.
- WP04: customers 784/784, participants 6/6, recruits 573/573, speakers 6/6 mapped; zero exceptions.
- Targeted L04a/L04b/M08/M09 regressions passed in the release checkout.
- Shared module check: 60 copies across 30 functions match `_shared`.
- CloudOnly source check passed after deployment: 103 reachable static assets and 30 functions/336 source-config files match.
- Open verification items retained by WP01: manual login, service runtime outside the tested read-only probe, live writes, and real mobile acceptance.

## Release identifiers

- Baseline: `eeef0b4565b3de3a4d835af34ce9734e3bb1c38f` (`release-20261114-124822`).
- Commit: the commit referenced by tag `release-20261115-094100`.
- Tag: `release-20261115-094100`.
