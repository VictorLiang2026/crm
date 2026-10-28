# Knowledge list category width and ID display

## Scope

- Increase the knowledge category table column from 9% to 13%; reduce summary from 37% to 33%. The remaining columns retain their widths and the table remains 100% wide.
- The category label `健康财富分享` now fits on one line at iPad portrait and landscape widths.
- No numbering change was needed: the current `K-`, `P-`, and `S-` suffixes are the primary-key `id` values from `public.knowledge_items`, `public.playbooks`, and `public.knowledge_sources`, respectively. The number header already sorts by `row.id` with numeric comparison.
- No API, data, schema, function, permission, or bilingual text change.

## Verification

- `node --check tests/pc22/knowledge-governance.browser.cjs`: pass.
- PC22 governance unit tests: 4/4 pass.
- Browser smoke: ID header orders `K-1`, `K-2`; `健康财富分享` fits on one line at 820×1180 and 1180×820; table fits viewport; zero runtime or network errors.
- Full `npm run test:pc22`: 12 passed, 1 pre-existing browser assertion failed before the new width assertions. It expects `6 MiB`, while the current upload form says `100 MB`; this is unrelated to the list layout and was not changed.
- WP01 on the source-aligned master: `PASS_WITH_LIMITATIONS`, 108 regression checks passed, 0 failed, 5 existing skips; anonymous checks 77/77. Login, service-runtime writes, live business writes, and real mobile visual acceptance remain unverified.

## Release

- The three already-deployed assistant PDF source files were synchronized separately, with user approval, in commit `9e12add`, tag `release-20261028-151353`; no function upload occurred.
- This package changes only `crm/css/console.css` and the PC22 browser assertion. Static asset publication, Git commit/tag, and final synchronization remain pending.
