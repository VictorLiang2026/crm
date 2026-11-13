# Requirements: AI Assistant Consolidation

## Scope

Make Console the single user-facing home for AI assistant capabilities. Migrate useful AI workflows currently reachable only from `admin.html`, route legacy AI URLs to their Console destinations, remove misleading or redundant AI cards, and improve the AI Results & Outcomes page. Preserve non-AI legacy CRM pages, existing business records, AI audit records, service contracts, human confirmation boundaries, and old URLs as redirects.

## User stories and acceptance criteria

1. **Unified entry** — When a user opens the AI Assistant, the system shall show one Console home with bilingual, actionable links for supported capabilities.
2. **Legacy URL continuity** — When a user opens an old AI route in `admin.html`, the system shall redirect to the corresponding Console route without rendering the legacy AI hub.
3. **Action workflows** — When a user creates, updates, or closes an Action or Opportunity, the system shall preserve the existing server-verified Preview, human Confirm, and scoped Execute flow.
4. **Activity review** — When a user opens a Console Activity, the system shall use the existing review-candidate workflow. Duplicate legacy review previews shall no longer be required to reach that workflow.
5. **Useful capability discovery** — When a capability already lives in People or Today, the AI home shall link to that canonical location; it shall not duplicate the capability.
6. **Unimplemented capability** — When opportunity analysis is not supported, the AI home shall not present it as an available action.
7. **AI results organization** — When a user opens AI Results & Outcomes, the system shall present filters, selected-result evidence and decision controls, actual outcomes, and learning review as distinct, understandable sections.
8. **Responsive iPad layout** — At iPad portrait and landscape sizes, the updated pages shall remain usable without horizontal overflow.
9. **Language support** — All new or changed interface text shall use the Console i18n dictionary and support Simplified Chinese and English.
10. **No data or service change** — The change shall not alter database objects, permissions, Cloud Functions, AI model routing, business payloads, or historical data.

## Non-goals

- Building new opportunity-analysis AI.
- Removing or restructuring the overall `admin.html` legacy CRM application.
- Changing backend execution, AI result schemas, or database storage.
- Designing or validating phone layouts.
