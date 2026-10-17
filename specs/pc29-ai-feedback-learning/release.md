# PC29 release record

- Scope: human feedback on AI results, manual actual Outcome records, and reviewed Learning candidates. Existing PC18/PC20 and legacy workflows remain available.
- Database: migration `20261017230000_ai_experience` applied to `crm-d1gkae8ddc930d151`, `public` schema only. The paired rollback is guarded and must not run while PC29 records exist.
- Fictional transaction: `tests/pc29/validate-transaction.sql` passed; its transaction rolled back. Follow-up counts found no retained PC29 test rows or fictional Person.
- PC29 regression: `npm run test:pc29` passed 7/7. PC15, PC18, PC20, PC25, PC26, PC27, and AI Gateway regressions passed earlier in this work package.
- Compatibility and security: `npm run check:shared` and `npm run test:modular` passed. `npm run test:wp01` passed with `PASS_WITH_LIMITATIONS`: 981 catalog checks, 68/68 anonymous probes, 108 browser regression checks, 0 failures, and 5 declared skips. Manual login, service-role runtime, live business writes, and real mobile acceptance remain unverified by design; WP04 retains 3 declared identity exceptions.
- Cloud artifacts to deploy: existing `assistant` function only; Console module files `crm/js/modules/console/ai-experience.js`, `crm/js/modules/console/i18n.js`, `crm/js/modules/console/pages/misc.js`, `crm/js/modules/console/router.js`, `crm/js/modules/console/views.js`, and `crm/css/ai-experience.css`. No `admin.html` or legacy business function changes.
- Rollback: use `cloudbase/rollbacks/20261017230000_ai_experience.sql` only after export and review of PC29 data; the SQL aborts if PC29 data is present. Static/function recovery should redeploy the prior release artifacts.
- Release commit/tag, remote deployment verification, and final cloud consistency checks are recorded after deployment below.
