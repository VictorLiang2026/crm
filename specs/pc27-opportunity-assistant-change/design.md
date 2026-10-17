# PC27 design

## Compatibility and impact

- Adds a bilingual Assistant entry and authenticated Assistant routes for Opportunity interpretation, manual target selection, preview, confirmation, and execute.
- Uses the configured AI Gateway and existing `PersonService.resolveName()` path. Natural-language output contains mentions and validated values only; IDs are supplied by manual UI selection.
- Adds a separate service-role-only Assistant command ledger/RPC. Edit previews merge only requested fields with the locked current database row (preserving nullable fields); stage and close delegate to PC15's existing `public.crm_opportunity_preview_v1` / `crm_opportunity_execute_v1`. The Assistant ledger binds actor, Person, Opportunity, preview digest, versions, expiry, confirmation, and one-shot result while the PC15 manual flow remains unchanged.
- A confirmed edit updates only the four approved draft fields; stage changes write only an allowed status; close writes the terminal status plus one Outcome containing the human-provided result. No Action association is offered.
- Legacy customer Opportunities remain read-only in PC15 and are rejected by the existing Person-only RPC. No existing route/function/table is removed or renamed.

## Interface specification

- Purpose: let an authenticated CRM user request a bounded Opportunity change, select a Person and exact target, inspect the authoritative server diff, then separately confirm and execute.
- Direction: reuse the existing Console editorial/utilitarian language, spacing, typography, semantic colors, buttons, and source/status patterns. No new visual system.
- Palette and type: existing Console CSS tokens only.
- Layout: iPad-first single-column command sequence; on landscape, compact two-column before/after values; on portrait, stack values. All copy uses `crm/js/modules/console/i18n.js` and `t(key)`.

## Data flow

1. The authenticated Assistant asks the configured AI Gateway for a bounded `edit`/`stage`/`close` proposal. This does not select an ID or write business data.
2. The server resolves the Person mention; the user selects a Person. The server resolves again before showing opportunities.
3. The server lists in-scope active Person-only Opportunities. The user selects one exact row.
4. The user reviews the normalized operation and requests preview. The database merges the edit patch with the locked current row, or invokes PC15's preview for stage/close, then stores an actor-bound Assistant confirmation record with a digest of the actual database-backed preview.
5. The UI displays the authoritative before/after values and expiry. A separate confirm action records the exact digest for the same actor.
6. Execute locks the Assistant confirmation record. Partial edits update only the requested columns after rechecking scope and versions; stage/close invoke the existing Opportunity execute RPC within the same transaction. The close executor writes the Outcome. Replay returns the stored result without a second write.

## Migration and rollback

- Public schema only. Add a service-role-only Assistant confirmation ledger/RPC; no changes to existing manual Opportunity ledger semantics or grants.
- Pair every forward migration with rollback. Rollback refuses if any Assistant Opportunity command was confirmed/executed; it does not revert Opportunity or Outcome business rows.

## Regression

- Server/model contract: allowed operations/fields, bilingual values, no IDs/SQL, unsupported intents, target resolution, and strict shape.
- SQL transaction using only registered fictional Person/Opportunity/Action fixtures: malformed or cross-Person requests, legacy customer rejection, stale versions, expiry, forged confirmation, close result/Outcome, and replay idempotency. Roll all fixture changes back.
- Browser: manual Person and Opportunity choice, before/after, confirmation separation, close Outcome disclosure, Chinese/English iPad portrait/landscape.
- Compatibility: PC15 workflow and directory, legacy customer Opportunity reads, Action/Outcome details, assistant PC25 read-only intents, AI Gateway registry parity.
