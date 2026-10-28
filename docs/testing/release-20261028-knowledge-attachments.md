# 2026-10-28 Knowledge attachment release

## Scope

- Added private CloudBase PG Storage bucket `knowledge`, capped at 100,000,000 bytes, with PDF, Office Open XML, text, CSV, PNG, JPEG and WebP MIME allowlist.
- Added per-authenticated-user object path policies and a service-role-only OCR metadata RPC. Business metadata remains in `public.knowledge_sources`.
- Knowledge upload now stores the original object in CloudBase Storage and keeps only metadata/path in PostgreSQL. The legacy Base64 upload route remains capped at 6 MiB.
- Removed the source-URL prerequisite for an attached industry/legal source, fixing `SOURCE_METADATA_REQUIRED` for that upload path. Manual knowledge entry retains its existing URL checks.
- Image OCR obtains a short-lived private object URL server-side; file bytes are not passed through Cloud Function invocation payloads.

## Files and database

- Migration: `20261028150000_knowledge_private_storage.sql`
- Rollback: `20261028150000_knowledge_private_storage.rollback.sql`
- Mirrored migration and rollback in `C:\Users\victor\cloudbase\migrations` (SHA-256 matched).
- `public.knowledge_sources` file-size constraint is 100,000,000 bytes. The rollback refuses to run while new-bucket objects or oversized/new-format sources remain.

## Deployment and verification

- Deployed Cloud Functions: `assistant`, `ai_parse`, `person_360`.
- Uploaded Console modules: `app.js`, `knowledge-pages.js`, `i18n.js`.
- Cloud source verification: 29 functions / 220 source and config files matched; 90 reachable static assets matched.
- Knowledge Library tests: 22 passed. Full regression: 108 passed, 5 historical skips. WP01 release gate: `PASS_WITH_LIMITATIONS`; anonymous checks 77/77 passed.
- Read-only public security catalog: 1,159 checks passed after adding the new service-role-only routine to the expected baseline.
- Live function probes: OCR rejects an invalid source as expected; assistant management invocation rejects unauthenticated callers; Person 360 rejects the unauthenticated probe.

## Known limits and unverified behavior

- Storage accepts files up to 100 MB. This does not mean every 100 MB file can be synchronously analyzed: the current PDF text parser is intentionally capped at 6 MiB; extracted text is capped at 100,000 characters. Larger PDFs need a separate bounded/async document-processing path.
- A real authenticated browser upload, OCR model call, summary generation and resulting knowledge record were not exercised in production. WP01 login evidence was expired; live writes and service-runtime probes remain unverified.
- Rollback is a recovery option only after confirming no new-format source/object remains; it was not executed.

## Follow-up: optional source URL validation fix (2026-10-28)

- Reported symptom: “上传或提取未完成，请检查资料和必填信息后重试。” despite all visible required fields being complete.
- Cause: the save path still rejected `industry_development` and `legal_tax` entries without an external source URL, while the form treats that field as optional. This returned `SOURCE_METADATA_REQUIRED` before the attachment/OCR flow could complete.
- Fix: removed only the hidden URL prerequisite. If a source URL is supplied, the existing HTTPS validation remains; publication date validation remains unchanged.
- Verification before deployment: Knowledge Library 23/23 passed; full regression 108 passed, 5 historical skips; WP01 release gate `PASS_WITH_LIMITATIONS` with no blockers. Live read-only login/permissions probe passed.
- Deployment: `assistant` deployed successfully after the release gate passed. A live read-only invocation reached the function and returned the expected `UNAUTHORIZED` response before knowledge processing, confirming the function is callable without creating data.
- End-to-end save using an authenticated session remains unverified; no production knowledge record or AI summary was created during validation.
- Release: commit `0e5d655`, tag `release-20261028-083120`; local, GitHub `master`, and CloudBase source checks matched.

## Follow-up: PDF extraction retry failure (2026-10-28)

- Reported symptom: a PDF source uploaded successfully but extraction failed; clicking “重试提取” returned `KNOWLEDGE_LIBRARY_FAILED`.
- Diagnosis: assistant delegated PDF parsing to `person_360`. The source object was private CloudBase PG Storage and no `knowledge_source_extract` task had been created, so failure was before AI task creation. The old Node SDK storage download path failed and both functions hid the useful cause behind generic errors.
- Fix: `person_360` now uses the authenticated server-side CloudBase object endpoint for private `knowledge` objects, checks the object owner path and `knowledge_sources.created_by` against the authenticated caller, and returns bounded safe PDF error codes. Assistant passes its authenticated actor to this route and preserves the allowlisted safe codes. Legacy `pg-private://` Base64 source support is retained.
- Verification: PDF-specific tests 6/6; knowledge-library tests 29/29; full regression 108 passed, 5 historical skips; security tests 5/5; shared copies 58/58 matched. WP01 release gate `PASS_WITH_LIMITATIONS`, 1,162 catalog checks, anonymous checks 77/77, fresh read-only login/permission probe passed. Open declared limitations remain service-runtime, production writes/AI, and real mobile acceptance.
- Deployment: `assistant` and `person_360` deployed successfully after their WP01 gates passed. Post-deployment CloudBase source check matched 29 functions / 221 source and config files; all 90 reachable page/module/style assets matched. No production knowledge source was retried or modified during validation.
- Live PDF extraction using the affected authenticated source was not run, to avoid creating/updating a real knowledge draft or AI task. The user can retry the source in the application; if it fails, the UI should now show the safe underlying PDF error code.
- Release tag: `release-20261028-095808`; the published commit is recorded in Git.
