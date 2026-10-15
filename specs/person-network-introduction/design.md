# PC10 Design

## Interface
- Keep the existing Console design system: `#D31145`, `#2E333B`, `#F5F5F7`, existing font stack, row components, badges, and i18n dictionary. This approved project design system overrides generic UI-skill font/color defaults.
- Person > Relationships remains the entry point. Keep relationship editing controls; add adjacency, directed path candidates, and separate household membership sections below them.
- Use readable lists rather than a graph. iPad landscape may place path list and selected-path details side by side; portrait stacks them. Every endpoint opens `#/person/<id>`.

## Server boundary
- Extend the existing authenticated `person_360` dispatcher; it rejects anonymous callers before constructing services.
- Add a `RelationshipNetworkService` using the existing public-profile `pgRequest` adapter. It accepts only Person IDs, page/expand parameters, and selected edge IDs; never accepts caller-supplied rows or proof metadata.
- Root adjacency is paged and fixed-size. Second-hop expansion is allowed only for a currently confirmed direct neighbor of the requested root. Enforce at most 50 unique nodes and 100 unique relationship edges in a response/view state, with `hasMore`/`truncated` flags.
- Two-hop candidate paths preserve edge direction and never repeat a node. Family membership is loaded from `households`/`household_members` with active, confirmed membership evidence and is returned in a separate collection.
- Person names are hydrated by numeric ID with `deleted_at IS NULL`; links to soft-deleted Persons are omitted.

## AI boundary
- Add an authenticated `person_360` action for a selected path. Rebuild the path from `public.relationships` and verify active/confirmed status, exact endpoints, direction, and one/two-hop length before calling AI.
- Use the existing `person_360/db.js` CloudBase AI Gateway wrapper and the existing `ai.js` referral guardrails. The model receives only the selected path and minimal current Person/customer referral context; it does not choose or alter edges.
- Sanitize a small fixed response shape and return it transiently. Never persist an AI suggestion, contact a Person, or create an opportunity here.
- Do not modify the unauthenticated legacy `ai_referral(customer_id)` endpoint. If a user later creates an opportunity, they use the already deployed opportunity-candidate confirmation and scoped preview/execute workflow.

## Data and limits
- Zero migration and permission changes. Only schema-qualified behavior through the existing `Accept-Profile: public` adapter.
- No relationship rows are converted from household memberships. `relationships.source`, `status`, `confirmed_at`, `updated_at`, `strength`, and `importance` are the available provenance/audit metadata; the schema has no external-evidence attachment, so the UI must not claim one exists.
- Do not calculate relationship trends in PC10.

## Verification
- Unit tests for bounds, confirmed-only filtering, endpoint liveness, direction, cycles/self-links, multiple paths, family separation, pagination, selected-path revalidation, and AI sanitization.
- Browser fixture tests for empty/capped views, Person-ID navigation, iPad orientations, bilingual labels, and AI advice preserving the verified edge list.
- Regression: PC09 lifecycle/permissions, PC04 Person and customer paths, existing opportunity candidate workflow, legacy `ai_referral` contract, and shared-module/release gates.
