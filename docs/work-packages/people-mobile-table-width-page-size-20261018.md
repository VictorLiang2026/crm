# People directory mobile table width and paging — 2026-10-18

## Scope

- On phone widths, the People directory name column scrolls with the table and sizes naturally to the widest row on the current page. Other directory columns use compact widths to reduce horizontal scrolling.
- People directory requests use 30 rows per page on phones and iPads. Desktop remains at 20 rows per page.
- iPad presentation is unchanged. Recycle Bin and other pages are unchanged.

## Impact

- Front end only: `crm/js/modules/console/pages/people.js` and the phone-only People directory rules in `crm/css/console.css`.
- No database, API contract, authorization, or business-data changes.

## Verification

- Browser regression: `npm run test:people-pages` covers existing People sorting, filters, recruit badges, and Recycle Bin behavior, plus phone horizontal movement/name sizing, 30-row paging, iPad 30-row paging with prior full date presentation, and desktop 20-row paging.
- Syntax: `node --check crm/js/modules/console/pages/people.js`; `node --check tests/console/people-pages.browser.cjs`.
- Combined-worktree browser result: 5 passed, 0 failed. The new scroll assertion waits for its style sheet before measuring layout; syntax and `git diff --check` passed.
- Deployment: uploaded only `people.js` and `console.css` to CloudBase static hosting. Both online files returned HTTP 200 and their SHA-256 values match the tested source.
- Post-deployment source check: `sync-check.ps1 -CloudOnly` confirms `admin.html` and both target files, then stops on the unrelated production `data.js` additions for PC35. No other files were uploaded.

## Rollback

- Revert the release commit and redeploy the previous versions of `people.js` and `console.css` to their exact `/crm/` paths.

## Not verified

- Physical phone/iPad hardware; browser device emulation was used.
- Authenticated production workflow and physical device remain unverified. Independent PC35 Console changes caused a reciprocal source check block; the user approved combining the two non-overlapping packages into one release. The combined release is planned as `release-20261018-173836` and must pass the full post-release three-way check before either package is marked complete.
