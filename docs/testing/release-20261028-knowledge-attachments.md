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
