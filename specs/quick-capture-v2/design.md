# Quick Capture V2 design

The existing `ai_parse` action accepts an explicit V2 request while retaining the V1 branch unchanged. The V2 branch uses the currently configured CloudBase model to produce a strictly validated, bounded draft; it does not query privileged Person tables or write records.

The modular `crm/js/modules/quick-capture-v2.js` renders the input and editable preview. The existing `admin.html` host only checks the default-off flag and loads the module, passing its authenticated `callFn` bridge. The module calls the existing `person_360` function for server-side `PersonService.resolveName()` and for the final write. A candidate ID is never accepted without an explicit user choice and a second server-side check.

`person_360` already holds a server-only public-schema API Key and checks the real CloudBase UID. Its new V2 actions retain those boundaries. One restricted `public` RPC performs the Interaction and Context Item inserts in a single PostgreSQL transaction. The RPC accepts only bounded Fact and Signal strings, fixes AI provenance, and always sets `confirmed=false`. The function is granted only to `service_role`; the migration has a guarded rollback. The browser cannot call the RPC directly.

Opportunity, Action and Commitment candidates are visible and editable but not persisted in V2. The user accepted this first-stage write scope. No old customer, followup, opportunity, recruit or speaker endpoint is changed.

The UI follows the current CRM visual language: green primary action, blue Fact cue, neutral cards and Chinese typography. A linear draft-to-preview-to-confirm flow keeps the identity decision prominent. The button is disabled while saving; errors retain the draft for correction.
