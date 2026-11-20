# Daily inspiration release record

## Scope

- Replaces the Today page greeting with one bilingual industry-inspired quote selected for the user's local date and configured period.
- Adds a small “Change / Keep” menu, quote management under More, source links and an editorial-rewrite marker.
- Adds per-user timezone and two configurable time boundaries. New boundaries take effect the next local day.
- AI Gateway receives only the date, period and enabled quote candidates. It returns a candidate ID; the server validates that ID. A stable deterministic selection is used if the AI request fails.
- Uses the existing `assistant` function and configured CloudBase `cloudbase` group/model. CloudBase personal resource-points billing is in effect; no Token Credits key or fixed model provider was added.

## Database

- `20261120135100_daily_inspiration.sql` and paired rollback created the library, settings, slots, history, RPC and five editorial paraphrases. Applied in `public` on `crm-d1gkae8ddc930d151`.
- The first live catalog exposed inherited direct table/sequence grants to client roles. The row policies still denied row access. Added and applied `20261120142200_daily_inspiration_acl_hardening.sql` with paired rollback: client grants removed, service-role grants limited to the operations the server needs.
- Remote migration history contains both versions. Live checks confirm four tables, seven objects in the reviewed security snapshot, five seed quotes, client table `SELECT=false`, RPC `anon/authenticated EXECUTE=false`, and `service_role EXECUTE=true`.
- Rollback files are mirrored under `C:\Users\victor\cloudbase\migrations`; hashes were compared before application.

## Validation

- Syntax checks, `test:ai-skills` (12), daily-inspiration service tests (5), daily-inspiration browser test (1), modular frontend check, AI Gateway tests (18), More/static tests (4), and full regression (102 pass, 0 fail, 5 planned skips).
- `test:wp04`: pass, fresh read-only snapshot; no identity exceptions.
- Security catalog: 1,773 assertions pass; no permission or policy drift after hardening.
- WP01: `PASS_WITH_LIMITATIONS`; 123/123 anonymous probes, service-role read-only probe, PC34 checks and full CRM regression pass. Real interactive login, production business writes/AI, and mobile visual acceptance remain unverified.
- `check:release-gate`: pass.
- `build:shared` and `check:shared`: pass; all 60 copies in 30 functions match.

## Deployment

- `assistant` function code deployed through `tools/deploy-function.ps1`.
- Eight changed static files uploaded individually under `/crm/js/modules/console/` and `/crm/css/`; remote sizes and ETag MD5 values match local files.
- `sync-check.ps1 -CloudOnly` passed: 110 reachable static assets and all 30 functions / 347 source-config files match the current release source.
- GitHub commit and release tag are created by the final `tools/release.ps1` step.
