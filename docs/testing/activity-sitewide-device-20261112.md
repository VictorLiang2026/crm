# Site-wide device authorization and activity detail

## Finding

- Production function logs on 2026-11-12 show successful `verifyBrowserDevice` checks for the already approved browser, followed by `activities` requests returning `DEVICE_ACCESS_DENIED`.
- The legacy activity detail uses the same shared `deviceCall` transport as the rest of `admin.html`; it does not enroll or authorize the device per activity page. Each protected function call still carries a one-time signed proof.
- The shared transport previously treated every function-level `DEVICE_ACCESS_DENIED` as proof that the whole browser needed device setup, hiding the current page and redirecting. Activity detail also performs a narrowly scoped delegated roster read, which is separately checked by the server.

## Change and compatibility

- Track the verified site-wide device state in the shared transport module for the CloudBase app instance.
- After a function denial, recheck the browser device through `person_360.verifyBrowserDevice`; retry the read-only activity detail once after a successful recheck.
- Redirect to device setup only when the site-wide device check fails. If the device remains approved but an individual API denies its operation, surface that API error to the existing page handler.
- Keep signed per-request proofs, one-time challenge consumption, server-side device approval, internal delegation scope, and all writes unchanged.
- Affects all pages calling the shared transport in legacy `admin.html` and Console. No database, permission, function, route, or business-data changes.

## Verification

- `tests/device-access/transport-retry.test.cjs`: site authorization distinguishes API rejection from missing device approval; activity detail retries only as a read; no redirect while site authorization remains valid.
- `tests/security/device-delegation.test.cjs`: added exact `getRosterFacts` delegation path coverage using a fictional actor and mocked public RPC.
- Focused device/delegation/activity regression: 13 passed, 0 failed.
- Browser device signature and setup page tests passed; activity roster tests passed (2 passed).
- WP01 release gate: `PASS_WITH_LIMITATIONS`; 1518 catalog checks passed, WP04 identity passed, anonymous 104/104 passed, system regression 104 passed/0 failed/5 skipped, no blockers.
- Remaining gate limitations: manual login, service runtime, production writes, and mobile visual acceptance are unverified.
- WP01 release-gate results to be recorded after the final run.
- Live user-browser activity click cannot be replayed from the deployment account; production logs and post-deployment static-resource checks are the available online evidence.

## Rollback

- Restore the pre-change `crm/js/modules/device-access/transport.js` SHA-256 `CEE27CF248EF5A27110C4B995B72926C9AD9DED5097DDE16A0381E8E5B603082` at the same hosting path.
- Revert this commit to roll back the tracked code and test change. No cloud function or database rollback is needed.
