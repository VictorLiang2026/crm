# Legacy Interaction Adapter work package

Modification baseline: local/GitHub HEAD `32a365f7527b5b26d459fe81ab46736258ad7eca`, tag `release-20260927-002337`; clean working tree; online `admin.html` hash and all 27 CRM functions (114 source/config files) matched. Existing `person_360` timeline already read followups, recruit followups, and attended activity participation inline.

Scope: isolate those three legacy source mappings in a read-only adapter. No schema migration, view, historical copy, source mutation, or existing legacy CRUD change. Source reads remain bounded and restricted to active records. No dry-run/backfill is needed because no backfill will be performed.

Baseline regression before edits: interaction tests 11/11, household tests 5/5. Standalone adapter tests verify the three mapped sources, source IDs, date/field mapping, active-only filters, GET-only calls, and invalid identity rejection. The new adapter suite and existing interaction suite passed 13/13; full isolated CRM regression passed 60, failed 0, skipped 5. A first browser launch was blocked by the local sandbox; the rerun in an isolated, network-blocked browser passed, as did the subsequent full run. Shared-copy check, syntax checks, and diff whitespace check passed.

The existing `person_360` route remains unchanged until the adapter integration scope is confirmed. This source-only stage is not deployed to a function, so no production invocation through the new adapter has occurred. Cloud-hosted business artifacts remain unchanged; no historical rows were copied or modified.
