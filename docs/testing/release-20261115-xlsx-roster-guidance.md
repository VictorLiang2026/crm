# XLSX people roster guidance — 2026-11-15

## Cause and change

The uploaded `赖茂生老师学生名单.xlsx` was sent through the single-Person attachment importer. That flow intentionally parses only text, images and PDF; it saved the original and correctly marked XLSX as unsupported. A separate People Import / Export workflow already reads XLSX rosters and is the correct flow for importing multiple students.

When an unsupported `.xlsx` appears in the attachment queue or history, show a bilingual explanation and a direct link to `#/people-list-transfer`. The original file stays attached to the current Person; the user selects the local file again in the roster importer. Other unsupported formats keep their existing message. No parsing, database, identity or write behavior changed.

## Scope and safety

- Static files deployed: `crm/js/modules/console/file-import.js` and `crm/js/modules/console/i18n.js` only.
- The existing roster importer continues to parse locally (CSV/XLSX; 5 MB, 1,000 rows, 100 columns), suggest header mappings, preview identity matches and require human confirmation before writes.
- No Cloud Functions, database objects, permissions or business data changed.
- Rollback: redeploy these two files from baseline `release-20261115-094100`.

## Verification

- M09 browser regression passed in Chinese and English; the unsupported XLSX link appears in both the upload queue and saved history, while DOCX retains the generic note and unsupported files are never sent to single-Person parsing.
- Person list transfer file, mapping, migration contract and service tests: 28/28 passed.
- WP01: `PASS_WITH_LIMITATIONS`, no blockers; WP04 public-only read-only identity audit passed with zero exceptions.
- Release gate keeps manual login, production writes/service runtime and physical mobile acceptance marked unverified.

## Release identifiers

- Baseline: `18be08ad8ba0367dd547dc6847a1de2686a6eb76` (`release-20261115-094100`).
- Commit: the commit referenced by tag `release-20261115-191605`.
- Tag: `release-20261115-191605`.
