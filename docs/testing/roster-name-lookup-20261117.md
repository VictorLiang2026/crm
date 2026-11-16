# Person and activity roster name lookup

Both entry points called the roster lookup after the Person organization column had been renamed to graduation_school. That read failed with PostgreSQL 42703 even for an unused name. Migration 20261116232000 updates only the lookup projection. The Person row returns graduation_school and a null organization compatibility field. Independent roster profiles retain separate school and company fields. The separate participant-to-Person write issue remains open.

Baseline eff12fd matches the deployed education package. The previous GitHub release was 0b22e0e. This patch adds a migration, its rollback and regression coverage. No application bundle or cloud function deployment was required.

The isolated database reproduced 42703, verified rollback and repeat application, and checked the function identity and access controls. The service returned active same-name candidates, recognized a deleted identity and distinguished an independent roster profile and an unused name. Identity review and preview were exercised at desktop, iPad and iPhone sizes in Edge (3 Person and 7 roster tests). These were browser fixtures, not physical devices.

WP01 passed with its existing limitations. The browser regression suite reported 102 passes, 5 preset skips and 0 failures. All 111 anonymous access checks passed. Manual production login, physical device acceptance and live writes were not exercised.

CloudBase migration task task-c92393f16b134c59 succeeded. Its immediate history check missed the record. Subsequent migrationDetail returned the exact migration, and the live routine body checksum was 2db9e472dd9191db2f399be7269e92ab with its original ACL. A read-only lookup as service_role returned zero persons and zero roster profiles for an unused synthetic name.

The matching rollback restores the previous lookup projection and will reproduce 42703 with the current Person schema.
