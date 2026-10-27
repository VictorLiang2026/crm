# Knowledge publication fields, OCR, and staged uploads

Date: 2026-10-27

## Scope

- Upload source: removed jurisdiction and effective/expiry dates, and the two user-declaration checkboxes. Publication date defaults to the current local date. Source review date remains available.
- New knowledge: removed jurisdiction, source date, effective/expiry dates, and the two declaration checkboxes; added publication date.
- Conversation strategy: removed evidence/case/story reference IDs, source, and expiry date. The server records a publication date and does not require those optional links for retrieval.
- Publication dates are stored in metadata. Legacy database columns remain in place for compatibility; new saves leave old date columns empty.
- User-declaration checks were removed. Automatic detection that blocks identifiable client personal information remains enabled for top-performer sharing.

## Database

- Migration: `20261027170000_knowledge_publish_fields.sql`
- Rollback: `20261027170000_knowledge_publish_fields.rollback.sql`
- Applied to the configured production `public` database on 2026-10-27; migration registry reports version `20261027170000`.
- Updated service-only knowledge review routines to stop requiring removed jurisdiction/date/reference inputs. Existing tables and columns were retained.
- Migration backup synchronized after the final migration names: 242 local and external files match.

## Image OCR and supported source files

- New source upload uses sequential 768 KiB chunks so a 6 MiB file does not exceed the synchronous Cloud Function event limit. The existing one-shot upload remains capped at 3 MiB for compatibility.
- Supported extensions: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, PNG, JPG/JPEG, and WEBP. Office documents are extracted locally in the function; images use the CloudBase configured model group and a configured vision-model name. No model vendor or model identifier is hardcoded in source.
- PDF extraction now reads the staged source by ID from `public.knowledge_sources`; the browser never sends the complete Base64 file in one function event.
- Image text and document extraction still produce a knowledge draft. The operator reviews the draft and marks it effective. Identifiable personal data in top-performer sharing sources remains blocked, and the staged original is deleted when this check rejects it.
- Migration `20261027180000_knowledge_source_upload.sql` raised the source byte limit to 6 MiB and the private Base64 field limit to 8,388,608 characters. Its paired rollback refuses while oversized or in-progress uploads exist. CloudBase reported the migration task `Succeed`; `migrationDetail` and a public-only constraint query confirm the migration is registered as latest and both constraints are 6 MiB. External migration backup contains 242 files with matching hashes.
- The image OCR handoff reuses the existing `ai_parse` function and its vision model setting. The production `ai_parse` configuration was updated from the unsupported `glm-5v-turbo` setting to the active `hunyuan-t1-vision-20250916` model; runtime and 120-second timeout were preserved. The assistant sends a staged source ID and upload capability, not the full file payload.
- A read-only, capability-gated `public.crm_knowledge_ocr_input_v1(bigint,uuid)` routine lets the existing OCR function read staged originals while `knowledge_sources` remains service-only. With user approval on 2026-10-27, migration `20261027181000` was applied. The CloudBase task reported success; the migration registry and public catalog confirm it is latest. Execute is granted only to the CloudBase function `anon` role; it returns supported images in `extracting` state only when the random upload token matches. The exact SECURITY DEFINER/anon-execute exception is recorded in the security baseline and routine exception list.

## Verification

- Latest Knowledge Library tests: 18 passed, including the simulated 6 MiB staged PNG upload, OCR source-token handoff, OCR service validation, model answer-wrapper cleanup, and migration privilege contract. The model call itself was mocked in unit tests.
- PC22 and meeting-prep tests: 13 passed.
- PDF extraction tests: 3 passed; modular frontend check passed; security fixtures: 5 passed.
- Full regression: 108 passed, 0 failed, 5 skipped by existing test policy.
- WP01 release gate: `PASS_WITH_LIMITATIONS`; anonymous read probe 77/77 passed, PC34 passed, and fresh public catalog plus identity audit passed.
- The first browser regression run had one intermittent Quick Capture v2 fixture timeout; an isolated rerun and the final complete gate both passed.
- Human login evidence, production write probes, and real mobile visual review remain unverified by the existing gate.

## Release state and outstanding item

- OCR code, staged upload code, UI, both database migrations, and the `ai_parse` vision model configuration are deployed. Migration `20261027181000` is applied. The three affected functions (`assistant`, `ai_parse`, `person_360`) and the two changed console assets were uploaded on 2026-10-27. Cloud source verification matched all 29 configured CRM functions (220 source/config files); all 90 reachable page/module/style assets matched.
- The earlier CloudBase MCP project-scoped API key could not invoke functions and returned `Cam authentication failed` before runtime execution. Switching the management session to account-level device authorization resolved this tooling-side block; the target environment remains `crm-d1gkae8ddc930d151`.
- After deployment, a real `ai_parse` invocation with a generated PNG containing `OCR SYNTHETIC 123` returned that exact recognized text (RequestId `b6741bf1-6ca1-4954-9177-d229955560f8`, 3.8 s). OCR response normalization now removes only leading/trailing `<answer>` wrappers while preserving recognized content. A prior synthetic request returned `INVALID_IMAGE` before model use; a regenerated and locally validated PNG passed input validation and OCR.
- A management-plane invocation of `assistant` returns the expected `UNAUTHORIZED` because it does not carry a CRM user's app session. Thus the live OCR function/model route is verified, while the authenticated browser upload-to-assistant flow still requires verification from an active CRM session.
- Fresh public-only catalog and identity evidence were collected on 2026-10-27; identity audit passed with the existing three explicitly documented participant exceptions. `npm run test:wp01` passed with limitations (108 regression pass, 0 fail, 5 existing skips; anonymous probe 77/77). The fresh release gate allowed the `ai_parse`-only deployment. Git commit/push/tag and final three-way source synchronization remain to be completed under the repository release procedure.

## Compatibility and rollback

- No existing table, view, route, or Cloud Function was renamed or deleted.
- To roll back the database routine behavior, apply the paired rollback SQL. Restore the prior frontend/function code from the recorded release tag and redeploy only the affected assets and functions. Database rollback does not remove data.

## Follow-up observations

- Keep the source review date for regulatory, tax, product, and campaign material; a lightweight stale-source reminder is more useful than requiring users to manage legal validity intervals for every item.
- After OCR is enabled, retain extracted text alongside a server-side source reference and display extraction confidence so the user can correct OCR before publication.
- Later, assess retrieval quality with a small set of representative customer questions and expected source items. This can improve suggestions without adding more content categories or workflow steps.

## Knowledge list layout follow-up (2026-10-27)

- Added a sortable ID column with `K-`, `P-`, and `S-` prefixes for knowledge items, playbooks, and source records. Updated time now shows the date only.
- The list table stacks category chips and row actions vertically, narrows the title/category/action columns, and allocates 39% of the table width to the summary. Category and status filters share a 42 px control height; “Filter by status” is the default option inside the status select. Search width increased from 260 px to 340 px.
- No API, data, schema, or cloud-function behavior changed in this follow-up.
- Browser regression asserts the new header order and numeric sorting, date-only output, vertical chips/actions, filter alignment, status label, and relative column widths. PC22: 13 passed. WP01: `PASS_WITH_LIMITATIONS`; full regression 108 passed, 0 failed, 5 skipped. A first WP01 attempt had one existing Person 360 browser timeout; the isolated browser suite and complete WP01 rerun passed.
- Deployed only `knowledge-governance.js`, `i18n.js`, and `console.css` to the existing static host. Live asset check: all 90 referenced page/module/style assets match local files.
- The shared Git release is still pending the synthetic `ai_parse` invocation documented above; CloudBase returned `Cam authentication failed` before execution. No Git commit, push, or tag was made.
