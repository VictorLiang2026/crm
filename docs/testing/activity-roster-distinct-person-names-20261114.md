# Activity roster import: distinguish different people — 2026-11-14

## Scope and behavior

When an imported attendee is confirmed as a different person from one or more People with the same name base, the attendee remains an independent activity roster entry and no Person is created or linked. The importer now requires a parenthetical qualifier on the imported name and on every active Person in the complete same-base candidate group. The qualifiers must be unique across that group. More than ten same-base matches fail closed because the identity service cannot present a complete set for review.

The confirmation preview shows each Person's current and proposed display name. On confirmation, the server rechecks the complete candidate set, unchanged Person names and versions, and qualifier uniqueness in the existing `public.crm_activity_roster_v1` transaction. It updates only the Person display name and active `public.activity_participants.person_name` snapshots that refer to that Person. The imported attendee is stored with `canonical_person_id = NULL`. No table, view, route, permission, or public object was added.

## Impact and compatibility

- UI: activity roster CSV import analysis and confirmation; new prompts use the existing bilingual console dictionary.
- Server: `person_360` activity roster handler, plus the existing public roster RPC body. The RPC's existing `service_role`-only grant is preserved.
- Data touched only after explicit preview confirmation: matching active Person display names and their active activity participant name snapshots; one independent roster profile and activity participant row for each confirmed import.
- Legacy `different` selections without a complete, valid rename plan now fail closed when matching Persons exist. Existing same-person reuse, no-match independent import, and link/create flows retain their previous behavior.
- Database migration: `20261114173500_activity_roster_distinct_person_names`; rollback: paired `.rollback.sql`. The forward migration has an exact live-function MD5 precondition and changes only the existing public RPC.

## Verification

- Activity roster service and browser tests: 5 passed, 0 failed. The browser test covers default same-Person reuse plus the different-person name review and preview.
- Person list transfer and Person identity suites: 36 passed, 0 failed.
- Shared Cloud Function copies: 60/60 matched; modified JavaScript syntax checks passed.
- WP01: `PASS_WITH_LIMITATIONS`; public catalog 1,551 checks passed; anonymous probe 106/106; WP04 identity audit passed (customers 785/785, participants 6/6, recruits 573/573, speakers 6/6; no exceptions); isolated cross-module regression 102 passed, 0 failed, 5 preset skips; PC34 read-only security check passed.
- Remaining WP01 limitations: real interactive login, production business writes, service-role write runtime, and real mobile-device acceptance were not performed.
- CloudBase migration `20261114173500` is applied and appears in remote migration history. The live `public.crm_activity_roster_v1` function hash is `778e43a0f24d7c8ec1920b9bd355f4cc`; `anon` and `authenticated` cannot execute it, while `service_role` can.
- Deployment: only `person_360` and static files `crm/js/modules/console/activity-roster.js` plus `crm/js/modules/console/i18n.js` were uploaded. The function reports `Active` / `CodeResult=success`; the two CDN ETags match local MD5 hashes. Online `admin.html` returned HTTP 200 with matching SHA-256; 103 reachable page/module/style assets and all 30 Cloud Functions / 336 source and config files matched local.

## Release record

- Implementation commit: `4b5ac635afa9b83f2e8a9de0fd477d7fcb6da2de`; code release tag: `release-20261114-114915`.
- Pushed atomically to GitHub `master` with the release tag. Post-push verification passed: GitHub `master` and the tag point to the local commit; online `admin.html` returned HTTP 200 with matching SHA-256; all 103 reachable static resources and 30 Cloud Functions / 336 source and config files match local.
- The follow-up commit/tag records this receipt only; it does not change or redeploy CloudBase artifacts.
