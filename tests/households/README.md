# Household verification

- `verify-public.sql` is read-only. Run it against the production `public` schema after the migration; expected initial counts are zero, both RLS flags true, `anon`/`authenticated` SELECT false, and `service_role` SELECT true.
- `node --test tests/households/person360-service.cjs` checks the server boundary with an in-memory request stub. It does not connect to CloudBase or write production data.
- `node tests/households/browser-probe.cjs` opens an isolated browser for a human to log in. It calls only `person_360.get` for one existing Person and stores only booleans/counts/error in ignored `.results/`. Never enter a password in the terminal or a chat message.
- The main CRM regression suite has fixture-only Person 360 route/search checks. It never invokes the production family write actions.

Production add/remove/save behavior has no automated write test: it requires a separately identified test Person and explicit confirmation before creating a family record. Do not use a real customer as a disposable fixture.
