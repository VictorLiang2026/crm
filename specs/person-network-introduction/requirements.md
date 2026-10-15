# PC10 Person Network and Introduction Paths

## Goal
Let a user inspect verified Person-to-Person paths and request a reviewable introduction suggestion without inventing or writing relationship facts.

## Scope
- A bounded, read-only adjacency and directed path view inside Person > Relationships.
- Active, confirmed `public.relationships` edges only; household membership is a separate family section and never a referral-path edge.
- Paths contain one or two directed relationship edges. The service returns edge IDs, endpoint IDs/names, type, source, confirmation and update timestamps, strength, and importance.
- AI suggestions are optional, transient, based only on server-reloaded selected paths, and use the existing CloudBase AI Gateway adapter and referral guardrails.
- Existing `ai_referral(customer_id)` request/response contract and legacy route remain unchanged.
- Formal opportunities remain behind the existing opportunity-candidate review and preview/execute flow. PC10 never writes or sends from AI output.

## Acceptance criteria
- When an authenticated caller opens a Person network, the service shall return only active, confirmed edges whose Person endpoints are active.
- When a caller expands a neighbor, the service shall verify that neighbor is a confirmed direct edge before returning a bounded second-hop adjacency page.
- When the network exceeds its page or node/edge bounds, the UI shall show a truncation/pagination state and shall never imply the result is complete.
- When the user selects a path for advice, the server shall reload and validate the exact one- or two-edge directed path from the current Person to the selected target before invoking the AI Gateway.
- When no confirmed directed path exists, the UI shall say evidence is insufficient and shall not ask AI to fill missing edges.
- The UI shall label household membership separately and shall not use it to connect referral paths or infer sibling relationships.
- When an AI response is shown, the exact server-verified path and its metadata shall remain visible as the evidence; generated language shall be labeled as a suggestion.
- The legacy `ai_referral(customer_id)` caller shall continue receiving its existing response shape and behavior.
- The network view shall navigate by Person ID, not by display-name matching, and shall be usable in iPad portrait/landscape and Simplified Chinese/English.

## Non-goals
- No graph drawing, external graph database, schema/permission migration, relationship writes, data backfill, outbound contact, or automatic opportunity creation.
- No relationship-trend statistic; PC10 does not present a trend without a defined measurement window and source.
