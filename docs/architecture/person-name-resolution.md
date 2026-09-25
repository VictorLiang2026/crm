# Person Name Resolution V1

`cloudfunctions/_shared/person-service.js` exports the server-side `PersonService` and its read-only `resolveName(displayName)` method. It requires an authorized CloudBase RDB client. `public.persons` is currently service-role only; this module is not loaded by existing deployed functions or the browser.

```js
const { PersonService } = require('./person-service');
const result = await new PersonService({ rdb }).resolveName('张玮（电信）');
// result.nameKey === '张玮'; result.selectedPersonId === null
```

The key is the trimmed, lowercase base name with repeated spaces collapsed. Consecutive **trailing** `（限定）` or `(限定)` groups are removed from `name_key` but retained in `display_name`. Internal parentheses in a name remain part of the key. Empty or unbalanced qualifiers are rejected. Only active `public.persons` rows with an exact `name_key` are searched; the query selects six fields and fetches at most 11 rows to return 10 candidates plus a `hasMore` indicator. Phone, WeChat and notes are never returned by resolution.

| Result status | Meaning | Next action |
| --- | --- | --- |
| `available` | No active key match | New Person may be proposed; AI output still needs normal review before any write. |
| `confirm_existing` | One key match | Human confirms whether it is the same person. With a distinct qualifier, a new Person may be created **after** human confirmation. |
| `choose_or_qualify` | Multiple matches, duplicate qualifiers, or a truncated result set | Human chooses a concrete Person ID or adds a distinguishing bracket qualifier. |
| `confirm_qualified_match` | Multiple key matches, exactly one matching qualifier | Human confirms the indicated candidate. |
| `confirm_new_qualified` | Multiple key matches, new distinguishing qualifier | Human confirms creation of a separate Person. |

Every result has `selectedPersonId: null`; `qualifierMatches` is deterministic evidence for the UI, not an identity decision. `canCreateAfterConfirmation` is never permission for an AI agent to write. The future Quick Capture flow must call `resolveName` for every proposed person and wait for the user's decision before linking or creating a record. It must recheck within its eventual write transaction to handle concurrent creation. The existing Legacy Quick Capture is not changed by this foundation work package.

Migration `20260925170916_person_name_key.sql` converted deterministic legacy keys only. It is idempotent and refuses unexpected existing key values. The paired rollback restores the previous full-display-name keys only while linked names and migrated keys still match; it does not alter customers or unrelated Person records.
