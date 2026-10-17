# PC26 design

## Impact and compatibility

- Extends the existing Assistant Action command path in `cloudfunctions/assistant/action-command-service.js`, its authenticated dispatch in `assistant/index.js`, the existing Action command ledger, and the Console Action command screen. The `create` branch, legacy route output and PC06 `person_360` work-item flow keep their current contracts.
- `public.actions` is changed only through a server-side, service-role RPC in a transaction. No browser database permission changes. No other schema is inspected or changed.
- Add a paired migration/rollback for operation, target Action, and target version metadata. Existing command audit and create records are retained. Rollback restores the pre-PC26 function and refuses to discard any update/close audit; it never reverts Action business data.
- AI interpretation uses the existing AI Gateway / CloudBase configured model, with a strict bilingual structured output. No vendor/model is hard-coded and no production model call is needed for regression.

## Flow

1. User enters natural language. The server asks the configured AI Gateway for a finite command proposal. This stage performs no CRM read or write.
2. Server resolves the Person phrase using `PersonService.resolveName()`. The user selects a Person; the server resolves again and verifies the selected Person is still among the candidates.
3. The selected Person's server-scoped open/in-progress Action list is shown. User selects the exact Action, even if there is only one result.
4. `plan` stores `operation`, Person, target Action ID and validated changes in the existing `public.assistant_action_commands` ledger. The SQL RPC independently verifies target-to-Person linkage and state.
5. `preview` locks/reads current Person and Action state, builds before/after values, binds both versions, computes the server preview hash, and returns impact/expiry.
6. `confirm` binds the authenticated UID to the server preview hash.
7. `execute` re-locks/re-reads the Person and Action, checks versions, scope, state and expiry, then performs one allowlisted UPDATE and marks the command executed in the same transaction. Same command ID replays the recorded target result without repeating the update.

## Database shape

- Keep `public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text)` signature, permission and `create` input/response behavior.
- Extend `public.assistant_action_commands` with a constrained operation, optional target Action FK, and target Action version snapshot. The existing unique create-result ID remains for create; update/close target IDs are stored separately so the same Action can receive later commands.
- Extend the existing RPC by operation branch. For `update`/`close`, enforce exact field allowlists, active Person, target Action bound to Person, open/in-progress status, actor, version, expiry, confirmation hash and one-shot execute. Update/close status use a separate target reference in the ledger, preserving the existing create result invariant.
- Migration runs in `public` only, uses lock/statement timeouts, and changes no grants or RLS policies. Rollback refuses while any non-create command audit exists, restores the original create RPC, then removes only the empty PC26 columns/constraint changes.

## UI design specification

1. **Purpose:** Add a controlled update/complete path beside existing Action creation. The user should see the parsed command, person choice, exact target, authoritative before/after preview, expiry, and a distinct confirm/execute sequence.
2. **Aesthetic direction:** Existing CRM console's restrained editorial/utilitarian interface. Reuse its approved visual system and components.
3. **Color palette:** Existing Console CSS tokens and semantic status colors; no new brand colors or gradients.
4. **Typography:** Existing Console font tokens (brand override; no new font dependency).
5. **Layout strategy:** iPad-first single-column command and confirmation flow with compact two-column field comparisons at landscape width; on portrait widths, stack values. Reuse the Console's established form, action row, source/status chips, and danger styling instead of creating a new visual system.

## Failure handling

- AI parse failure/unsupported intent: return a bounded refusal; no CRM query.
- Missing/ambiguous Person or Action: return finite candidates and require human choice; never infer an ID from the model.
- Invalid scope, permission, stale record, expiry or mismatched hash: normalized error; require a fresh command and preview.
- Execute transaction failure: all business and ledger changes roll back together.

## Regression

- New flow: update one allowed field, multiple allowed fields, close, empty/no-op update, wrong Person/Action, duplicate candidates, unknown field, forged confirm, expiry, stale action version, stale Person version, replay, and failed transaction rollback.
- Compatibility: existing Action create and authenticated dispatch; PC06 manual edit/complete in Person and Today; Today list refresh; PC25 read-only assistant intent; legacy `intent-router` contract.
- Browser: Chinese and English, person/action manual choice, before/after sourced from fixture, no write before execute, stale/error/unsupported states, iPad portrait/landscape.
- Use only isolated/fictitious fixtures and the existing test disclosure mechanism; no real business write.
