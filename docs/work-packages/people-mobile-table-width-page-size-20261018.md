# People directory mobile table width and paging — 2026-10-18

## Scope

- On phone widths, the People directory name column scrolls with the table and sizes naturally to the widest row on the current page. Other directory columns use compact widths to reduce horizontal scrolling.
- People directory requests use 30 rows per page on phones and iPads. Desktop remains at 20 rows per page.
- Added the sortable “最近更新” column after Next Follow-up. It reads the existing `persons.updated_at` value, displays as `YYYY-MM-DD` on iPad/desktop and `DD/MM` on phones, and uses localized labels from the Console dictionary.
- iPad presentation is unchanged. Recycle Bin and other pages are unchanged.

## Impact

- Front end only: `crm/js/modules/console/pages/people.js` and the phone-only People directory rules in `crm/css/console.css`.
- No database, API contract, authorization, or business-data changes.

## Verification

- Browser regression: `npm run test:people-pages` covers People sorting (including `updated_at`), Chinese and English labels, filters, recruit badges, Recycle Bin behavior, phone horizontal movement/name sizing and compact date presentation, iPad full date presentation, 30-row paging on phone/iPad, and desktop 20-row paging.
- Syntax: `node --check crm/js/modules/console/pages/people.js`; `node --check tests/console/people-pages.browser.cjs`.
- Combined-worktree browser result: 5 passed, 0 failed. The new scroll assertion waits for its style sheet before measuring layout; syntax and `git diff --check` passed.
- Deployment: see the final release record below. The current deployment uploads only the People module, Console dictionary, and existing Console stylesheet to CloudBase static hosting; no functions or database objects are changed.
- Post-deployment source check: see final release record below for HTTP/SHA checks and the full local/GitHub/CloudBase comparison.

## Rollback

- Revert the release commit and redeploy the previous versions of `people.js` and `console.css` to their exact `/crm/` paths.

## Not verified

- Physical phone/iPad hardware; browser device emulation was used.
- Authenticated production workflow and physical device remain unverified. Device emulation verifies responsive presentation but is not hardware acceptance.

## Follow-up: recent update column — 2026-10-18

### Final release record

- Release commit and tag: recorded in the GitHub release history and final work-package report.
- CloudBase upload scope: `crm/js/modules/console/pages/people.js`, `crm/js/modules/console/i18n.js`, and `crm/css/console.css` only.
- No Cloud Functions, database schema, or business data changed.
- Each uploaded URL returned HTTP 200 and its SHA-256 matched the tested local source. `sync-check.ps1 -CloudOnly` and the post-release three-way source check must pass before marking this package complete.
