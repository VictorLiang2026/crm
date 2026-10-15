# PC09 implementation design

- Console Person adds a Relationships tab, with a compact edge list, direction and status filters, and reviewed actions.
- Console visual tokens: `#D31145` accent, `#2E333B` ink, `#F5F5F7` canvas, existing system font stack and controls.
- All new labels and feedback use the shared Simplified Chinese / English dictionary.
- `person_360` exposes list, resolve, preview and execute actions. The database command table and RPCs are service-role-only; source table writes remain behind those RPCs.
- Migration adds nullable `importance` and an append-only command ledger. RPCs validate actor, active Person endpoints, endpoint scope, supported operation, idempotency, expiry and row version. They store before/after preview data and execution result.
- Meeting preparation includes importance only for confirmed live edges. Existing search continues to filter confirmed edges.
- Migration rollback refuses to discard command history or populated importance values.
