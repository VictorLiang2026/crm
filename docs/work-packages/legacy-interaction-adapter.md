# Legacy Interaction Adapter work package

Modification baseline: local/GitHub HEAD `32a365f7527b5b26d459fe81ab46736258ad7eca`, tag `release-20260927-002337`; clean working tree; online `admin.html` hash and all 27 CRM functions (114 source/config files) matched. Existing `person_360` timeline already read followups, recruit followups, and attended activity participation inline.

Scope: isolate those three legacy source mappings in a read-only adapter. No schema migration, view, historical copy, source mutation, or existing legacy CRUD change. Source reads remain bounded and restricted to active records. No dry-run/backfill is needed because no backfill will be performed.

Baseline regression before edits: interaction tests 11/11, household tests 5/5. Standalone adapter tests verify the three mapped sources, source IDs, date/field mapping, active-only filters, GET-only calls, and invalid identity rejection. The new adapter suite and existing interaction suite passed 13/13; full isolated CRM regression passed 60, failed 0, skipped 5. A first browser launch was blocked by the local sandbox; the rerun in an isolated, network-blocked browser passed, as did the subsequent full run. Shared-copy check, syntax checks, and diff whitespace check passed.

The source-only stage was published as commit `7156a76c18e64a8d5f4f69d8910fb10f4b47c439`, tag `release-20260927-090203`, with cloud-hosted business artifacts unchanged. No historical rows were copied or modified.

The user subsequently confirmed integration into the existing Person 360 timeline. Modification baseline was clean and matched GitHub, online `admin.html`, and all 27 CRM Functions (114 source/config files). `InteractionService` now delegates the legacy GET sequence to the adapter while retaining Person validation, ledger reads, merge order, de-duplication, pagination and manual creation. The deployed `person_360` package receives matching copies of both shared modules. No action name, frontend route, schema, policy, or legacy writer changes.

Integration tests passed 13/13 for interactions (including the exact virtual ID/type/time contract and both module copy hashes) and 5/5 for existing household behavior. The full isolated CRM regression passed 60, failed 0, skipped 5. Syntax, shared-copy, and diff checks passed.

Only the `person_360` Function code was deployed. The post-deployment cloud check found the online page and all 27 CRM Functions (115 source/config files) matching local, including the new adapter copy. A real test-account browser session read one legacy timeline row and rejected an invalid manual-capture request before database write; its stored evidence contains only counts/booleans and no customer content or credentials. No production interaction record was created, and no backfill was run. The direct management CLI invocation uses admin credentials and is not evidence of anonymous access behavior; the unchanged login guard is covered by the isolated dispatch test.

Release tag: `release-20260927-094229`. If the read path regresses, restore the prior tagged `person_360` code and redeploy that one Function after assessing live behavior; no database rollback is needed because this work package has no schema or data changes.
