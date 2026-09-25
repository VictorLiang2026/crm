# Context Engine V1

`cloudfunctions/_shared/context-engine.js` provides `createContextEngine({ rdb }).buildContext({ recipe, subjectType, subjectId, options })`. It is a server-side, read-only builder for future AI calls. It is not imported by existing CRM functions or pages. The caller must supply an authorized CloudBase RDB client; this module does not elevate the caller's permissions.

```js
const { createContextEngine } = require('./context-engine');
const built = await createContextEngine({ rdb }).buildContext({
  recipe: 'person_basic', subjectType: 'customer', subjectId: 123,
  options: { interactionLimit: 5 },
});
await gateway.runAITask({
  taskType: 'person_summary', skill: 'person_summary', capability: 'summarization',
  subjectType: 'customer', subjectId: '123', input: { personId: '123' },
  context: built.context, contextSnapshot: built.context_snapshot,
});
```

The Gateway validates that `contextSnapshot` contains the exact model context plus `_context` provenance, then persists it with `_skill` in `public.ai_tasks.context_snapshot`. A caller that omits `contextSnapshot` retains the previous Gateway behavior. No model provider is selected here. The snapshot contains the data sent to AI and its source labels; consumers must not treat model output as an automatic business write.

| Recipe | Subject | Data included | Skill context |
| --- | --- | --- | --- |
| `person_basic` | `customer`, positive ID | customer, up to 5 recent followups, 5 opportunities | `person_summary` |
| `meeting_prep` | `customer`, positive ID | person basic, up to 3 policy reports and 5 product rows | `meeting_prep` |
| `quick_capture` | `none`, null ID | empty context; raw text belongs in the skill input | `quick_capture` |
| `today_coach` | `day`, `YYYY-MM-DD` | only records due on that day: up to 5 followups, 5 opportunities, 20 customers | `today_coach` |
| `activity_review` | `activity`, positive ID | activity, up to 20 participants and 20 tasks | `activity_review` |
| `recruit_coach` | `candidate`, positive ID | candidate, linked customer, up to 5 candidate followups | `recruit_coach` |

`interactionLimit` can be set from 1 to 10; the default is 5. All other limits are fixed. Every selected row has `{ data, source: { schema: 'public', table, id } }`. Only explicitly listed fields are queried and forwarded. Text is clipped to 600 characters, arrays to 8 entries; arbitrary JSON objects are not forwarded. Customer phone, income, raw policy reports, and candidate files are excluded. Deleted rows are filtered where the table supports soft deletion. A missing root subject or read error fails closed. The `today_coach` counts describe **returned, capped records**, not global totals; historical and overdue records are outside V1 scope.

`recruit_candidates` does not contain customer name or occupation. `recruit_coach` resolves its `customer_id` through `public.customers`. This V1 does not read global recruit goals, because they are not scoped to a candidate. `open_opportunities` follows the existing Skill Registry section name; each row retains its status so the caller can distinguish open from closed entries. No migration or existing function deployment is required.
