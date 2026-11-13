# Design: AI Assistant Consolidation

## Architecture

- Console `#/ai` becomes the canonical assistant home.
- Console routes host Action creation/change and Opportunity change modules using their existing render functions and server APIs.
- Console Activity detail already has the current PC18 review tab, which calls the same `ai_activity.postReviewV2` generation and `person_360.previewActivityReview` / execute operations as the old relationship-review widget. Keep the Console flow as canonical and remove the duplicate old widget entry; do not add another review workflow.
- `admin.html` keeps its legacy shell and business pages, but AI-specific hashes redirect to equivalent Console routes. `#/ai-suggestions` remains a compatibility redirect to `#/ai/experience`.
- Existing Person summary/meeting-prep and Today morning-brief experiences remain in their canonical Console pages. The AI home links to those destinations instead of implementing duplicates.
- Remove the unsupported Opportunity Analysis card from the visible AI home. Do not delete its unrelated server capability or historical data.
- Refine `ai-experience.js`/`ai-experience.css` only; retain API operations, field contracts, and human-review safeguards.

## Layout direction

Continue the established Console workbench style and design tokens. Use a compact top filter/metrics area, a clearly selected result with evidence and decision, then separated Actual Outcome and Learning sections. Keep raw JSON collapsed. Use a two-column list/detail view in iPad landscape and a sequential vertical flow in iPad portrait.

## Safety and compatibility

- No database migration, Cloud Function deployment, permission change, or AI provider/model change.
- Old AI URLs remain valid as redirects; no old AI page is rendered from those URLs.
- Existing Action/Opportunity Confirm/Execute contracts are unchanged.
- Activity review remains human-reviewed and does not automatically write Person, Interaction, Action, or Opportunity data.
- Preserve all non-AI `admin.html` routes and user work outside this package.

## Verification

- Static/module checks and focused browser/service suites for Action, Opportunity, activity review, AI results, route redirects, language, and iPad sizes.
- Run project release gate only after confirming it does not access forbidden `pr` resources; use targeted hosting/Assistant checks because the repository-wide sync script enumerates all function directories.
- Deploy only changed CRM static files. No Cloud Function or database deployment is in scope.
