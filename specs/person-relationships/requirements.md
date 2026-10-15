# PC09 Person relationships

## Goal
Give each Person a human-reviewed interface for maintaining directed relationship edges while preserving the existing derived-role and household models.

## Rules
- Only `public.relationships` is the relationship edge source. Customers/recruits/households and free-text profile fields remain distinct.
- Target Person selection comes from server-side `PersonService.resolveName()` results and requires an explicit candidate selection.
- Every create, edit, confirm, unlink, and restore uses a server-generated preview followed by a scoped execute. No browser direct writes.
- New manual edges start pending. AI suggested edges remain pending. Only confirmed, live edges feed meeting preparation and the existing fixed-template search.
- Edge direction is explicit; reverse direction is an independent edge. Existing active directed uniqueness and no-self-link rules remain in force.
- Add nullable 1–5 importance to the edge. Editing a confirmed edge records the current human confirmation.
- Unlink is soft deletion with audit history; restore rejects an active uniqueness conflict.
- Do not change PMC15 person-role derivation triggers.

## Compatibility
Legacy routes remain. Existing relationship reads stay read-only. Existing relationship decay signals remain separate from edge governance. Meeting-prep output adds importance; search behavior and query template remain unchanged.

## Acceptance
Identity ambiguity, direction, preview/confirm, duplicate/self/cross-person protection, replay, stale update, unlink/restore, confirmed-only consumers, bilingual UI and iPad layout have evidence. No production edge write is claimed without an explicitly approved test person and a completed human confirmation.
