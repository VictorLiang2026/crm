# Person roles and directed relationships

This work package adds `public.person_roles` and `public.relationships` as an additive identity layer. The user chose a directed Person-to-Person relationship (`from_person_id` → `to_person_id`). Existing customer, recruit and speaker stages, Cloud Functions and routes retain their current behavior.

Migrations: `cloudbase/migrations/20260925235318_person_roles.sql` and `cloudbase/migrations/20260925235929_relationships.sql`. Manual guarded rollbacks: matching files in `cloudbase/rollbacks/`. Both migrations were planned, dry-run and applied in order to production CloudBase `crm-d1gkae8ddc930d151`; they only touch `public` objects.

At application, role backfill produced 792 records: 776 customer, 12 recruit, 3 speaker and 1 participant. These are a one-time snapshot from explicit legacy customer IDs, not a live sync. Other supported roles had no evidence-based backfill. Relationships started with zero rows; no relationship was inferred from names or historic stages.

The read-only catalog check confirmed both tables and expected constraints/indexes, RLS enabled, `anon` and `authenticated` SELECT denied, and `service_role` SELECT granted. The read-only `tests/person-relationships/verify-public.sql` returned 792 roles, zero orphans, zero relationships, a valid directed active key, and all three legacy stage columns present. No production test record was written.

The existing regression suite passed 57 cases, failed 0 and skipped 5. The first run could not start the local browser debugger inside the sandbox; a rerun with browser access passed. `npm run check:shared` passed for all 52 shared copies. No page or Cloud Function artifact changed, so no cloud artifact was deployed in this work package. For runtime usage, a future work package must define controlled writes, role synchronization where desired, and relationship vocabularies before enabling any page or function consumer.
