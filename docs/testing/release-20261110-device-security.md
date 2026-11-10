# Device access baseline and security release (2026-11-10)

## Scope

- Reconcile the production device access bridge in `/crm/admin.html`, the actual console entry module `/crm/js/modules/console/app.js`, the `device-access` static modules, and deployed device-protected CRM functions into source control: `activities`, `activity_reports`, `activity_speakers`, `activity_tasks`, `activity_topics`, `ai_activity`, `ai_followup`, `ai_parse`, `ai_recommend`, `ai_recommendations`, `ai_referral`, `assistant`, `customers`, `followups`, `funnel_insight`, `gifts`, `opportunities`, `ocr_records`, `person_360`, `photos`, `pmc18_observer`, `policy_review_reports`, `products`, `recruit_candidates`, `recruit_followups`, `recruit_goals`, `recruit_recommend`, `recruit_score`, and `today_coach`.
- Restrict `public.crm_device_delegate_v1` to `service_role`; retain its existing RLS-protected tables and one-time delegation behavior.
- Keep the device-verification API key in `person_360` only. `activities` obtains a short-lived HMAC attestation after `person_360` verifies the browser signature, then asks `person_360` to issue the constrained `listActivityData` delegation. `activity_reports` uses the same broker for the single `recruit_goals.getProgress` read, and `recruit_goals` asks `person_360` to consume that one-time ticket. No device-key configuration is added to either caller.
- Carry the already-applied public activity-registration migrations and catalog entries as database provenance only. Do not deploy its pages, functions, routes, gateway policy, or `cloudbaserc` changes.

## Security and compatibility

- Transition migration `20261110193000` grants `service_role` read-only access under service-only RLS policies and grants it RPC execution, while preserving compatibility with the production caller until both functions are deployed.
- Hardening migration `20261110195000` removes `PUBLIC` / `anon` / `authenticated` execution and allows only `service_role` to issue or consume tickets.
- The `activities` to `person_360.listActivityData` path remains available after deployment through the signed server-to-server attestation. The console entry and legacy admin both verify device signatures on login/resume and route business calls and files through the device bridge. Existing device enrollment endpoints remain unchanged.
- The `activity_reports` to `recruit_goals.getProgress` path requires a browser request backed by a valid, 30-second `activity_reports` HMAC attestation; payload keys and the month range are checked before the service delegation is issued. The recipient consumes the one-time ticket through `person_360` before running the existing read handler.
- After explicit user authorization, `assistant`, `ai_followup`, `ai_recommend`, and `ai_referral` internal reads now use the same short-lived broker. `assistant` retains MCP and OCR queue paths through its existing server-only `CRM_ASSISTANT_DB_API_KEY`; that is an existing assistant-only key, not the device-verification key, and no new environment setting was added. Those machine paths issue only exact, allowlisted payloads. The follow-up, recommendation, and referral functions can delegate only `person_360.listInteractions`. The `ai_parse` OCR and `today_coach.daily_review` recipients consume tickets through `person_360`; ordinary entry behavior is unchanged. `ai_recommendations` and `customers` are source-synced from their existing deployed wrappers without a runtime behavior change.
- Ticket issuance is limited to fixed activity, assistant, and follow-up routes and exact read/OCR payload shapes. Browser attestations expire after 30 seconds and are HMAC-protected with the existing server-only key. Delegation tickets remain single-use and are consumed by the service-only RPC through `person_360`.
- The transition rollback is only safe before deploying service-role callers. The hardening rollback restores the previous anonymous RPC grant and therefore restores the reviewed security flaw; it is emergency-only.

## Verification

- `tests/security/device-delegation.test.cjs` and `tests/security/device-internal-call-targets.test.cjs`: migration privilege assertions, valid/forged HMAC attestations, denied routes, and assistant/follow-up/recommend/referral/OCR/Today ticket handling.
- Production wrappers and device runtime/control/proof helpers for CRM entrypoints are source-reconciled; wrappers copied without function business logic changes were not redeployed.
- Syntax checks passed for all changed runtime and entry files. Targeted meeting-prep/conversation-playbook, OCR queue, follow-up advice, and activity regressions passed.
- WP01: `PASS_WITH_LIMITATIONS`; catalog 1,399 checks, anonymous gateway 92/92, WP02/WP03/WP04/WP05/WP06 and PC34 passed, regression 104 PASS / 0 FAIL / 5 SKIP. WP04 retained 3 declared participant exceptions. Release gate open items remain login, service-runtime, live-writes, and mobile acceptance.
- The full CloudBase functions will be deployed individually, followed by cloud-only source sync and post-release three-end verification.
- Live database verification uses only `public` catalog metadata. No production business rows, real customer records, or storage objects are used for test fixtures.

## Release record

Pending: deploy `person_360`, `ai_parse`, `today_coach`, `assistant`, `ai_followup`, `ai_recommend`, and `ai_referral` in dependency order. `ai_recommendations` is source-only reconciliation. Then run cloud-only source sync, commit/push/tag, and verify local/GitHub/production consistency.
