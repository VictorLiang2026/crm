# Knowledge content versions — K01–K09

Approved in chat: two editable/deletable pairs, system regeneration, paired adoption, GPT supplementation only when the system pair exists. Latest clarification: GPT work happens manually in ChatGPT; this release imports pasted results and calls no GPT API. No new GPT skill or daily automation is included.

- [x] K01: read-only baseline and caller audit. Execution checkout `D:/CRM/crm-knowledge-content`, base `ae18dafb6d967386dc56b24ddf1bf473e54e7525`; 91 assets, 29 functions / 228 files match production. Evidence `D:/Temp/crm-cloud-audit-74b10a070f3e4aa7ae570c1a19099001`. Original checkout and its pending changes remain untouched.
- [x] K02: additive public-only fields, command/history store, service-only RPC, migration/rollback, view/permission checks.
- [x] K03: manual edit/clear/restore, server preview and scoped apply, stale/concurrent checks.
- [x] K04: resumable system regeneration from original attachments/current system text; candidate-only completion.
- [x] K05: manual GPT import, system-pair eligibility, provenance, no overwrite/automatic refill.
- [x] K06: shared effective-content resolver in dual suggestions, meeting preparation and playbook/evidence readers; immutable historical snapshots.
- [x] K07: bilingual iPad list columns and management panel, previews, progress and adoption.
- [x] K08: SQL rollback fixtures, server and browser tests, adjacent regression and WP01. 68 Node tests including private-reference regeneration of a 7 MiB image, 3 knowledge/iPad browser cases plus dual-follow-up browser case; 108 WP01 regression PASS, 0 FAIL, 5 historical SKIP; gate PASS_WITH_LIMITATIONS.
- K09 release receipt: assistant/person_360 and five frontend files deployed; live authorization/empty-queue smoke passed. Publication and final source parity are recorded by tag `release-20261030-124801` and the final PASS in `D:/Temp/kc-release.log`. See `docs/testing/release-20261030-knowledge-content.md` for validation limits and rollback. No further product work packages remain; do not mark a failed release as complete.
  Large-image compatibility follow-up: assistant only, tag `release-20261030-130244`, receipt `D:/Temp/kc-release-image-fix.log`; final delivery requires that receipt's final PASS as well.

Compatibility: existing nonempty content/response_logic constraints remain. Managed system text is a versioned override, including explicit nulls for cleared fields; original legacy columns remain as recoverable baseline. All live readers resolve the selected pair. No old table/view/function/route is dropped. All initial selections remain system. Historical suggestions retain their captured version. Newly generated results do not silently replace selected content.

UI: existing Console typography/colors/spacing; two bounded-preview columns and one management action. Full text is loaded in the panel, not repeated in every list row. Simplified Chinese default, English through i18n. Existing mobile behavior preserved.
