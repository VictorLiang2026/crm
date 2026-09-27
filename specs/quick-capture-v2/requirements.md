# Quick Capture V2 requirements

V2 stays inside the existing CRM. The `quick_capture_v2` feature flag is false by default. With the flag off, every existing Quick Capture entry, response and save path behaves as before.

1. When V2 receives raw text, it shall return a bounded, editable draft containing a Person name, an Interaction candidate, Fact and Signal candidates, and Opportunity, Action and Commitment candidates. Parsing alone shall write no business records.
2. Before preview or write, the server shall call `PersonService.resolveName()`. The user shall explicitly choose an existing Person; no AI or client-supplied match shall select one automatically. This version shall not create a Person.
3. The preview shall show all candidate groups separately, allow edits/removals, and require a deliberate confirmation before write. Opportunity, Action and Commitment candidates are preview-only in this package.
4. After confirmation, an authenticated server endpoint shall re-resolve and verify the selected Person, then atomically write one `public.interactions` row and only the retained Fact and Signal candidates to `public.context_items`. Every AI-sourced Context Item shall remain `confirmed=false`.
5. A failed identity check, invalid draft or database error shall write neither the Interaction nor any Context Item. The client shall never receive or store the database API Key.
6. The legacy `ai_parse.quick_capture` request and response shall stay compatible. New V2 code shall use model choice from CloudBase configuration and shall not name a model vendor.
7. Regression shall cover the V2 draft, identity choice, edit/confirmation boundary, write rejection, and the existing login, customer, followup, opportunity, activity, recruit and recycle paths.
