# Legacy Interaction Adapter V1

`LegacyInteractionAdapter` is a read-only projection over existing `public` CRM records. It returns interaction-shaped objects in memory and never inserts into `public.interactions` or changes a source row. The caller supplies an authorized database request function; only GET requests are issued. The current `person_360` request boundary restricts the source tables to GET and explicitly selects the `public` API profile.

| Source | Identity path | Event time | Interaction fields |
| --- | --- | --- | --- |
| `followups` | `persons.legacy_customer_id` → `followups.customer_id` | `followup_date`, fallback `created_at` | `interaction_type=followup`; summary from `interaction_summary` or `followup_notes`; note retained as `raw_note` |
| `recruit_followups` | customer → active `recruit_candidates` → `candidate_id` | `followup_date`, fallback `created_at` | `interaction_type=recruit_followup`; summary/note as above; `contact_method` becomes `channel` |
| `activity_participants` | customer/candidate or unambiguous linked speaker → attended participant → active activity | `activity_date`, fallback participant `created_at` | `interaction_type=activity_participation`; activity name becomes summary; `relationship_note` becomes `raw_note`; activity ID retained |

Every virtual row keeps the original `source_type` and `source_id`, has a stable `source_type:source_id` virtual ID, `importance=3`, and `virtual=true`. Date-only values use China local midnight, then ISO UTC. Deleted rows, invitations, absent/deleted activities, and ambiguous speaker links are excluded. Queries select limited columns and cap reads per source; this adapter is for a recent timeline, not a full historical export.

`InteractionService.listForPerson()` validates the Person, reads stored ledger rows, then delegates legacy reads to this adapter when `legacy_customer_id` exists. It retains the existing merge, ordering, limit, and de-duplication behavior; materialized source rows win over virtual duplicates by `(source_type, source_id)`. The `person_360` Function packages a copy of both service and adapter modules, matching the shared-source hashes.

This read-through integration does not require a migration, database view, or backfill. If a future backfill is requested, first run a separate read-only dry-run that reports eligible counts and sampled source-to-interaction mappings; execute only after explicit confirmation.
