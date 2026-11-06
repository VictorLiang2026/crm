# PMC11: Legacy AI entry points and Person AI Gateway map

Date: 2026-11-07
Scope: read-only endpoint and test coverage audit for optimization task 4. No runtime code, Cloud Functions, routes, database objects, or production data were changed.

## Findings

The system has a current Person AI Gateway experience, but that does not mean all older AI functions have been migrated. The Gateway is routed through the authenticated `assistant` Cloud Function and has Person-scoped task/history contracts. Multiple older features remain actively called from `admin.html` and still serve their original customer, activity, recruitment, import, or policy workflows. They must remain classified as Legacy until a separately approved migration changes their callers and compatibility behavior.

Identity adaptation in an old prompt is not endpoint migration. `ai_referral`, `recruit_score`, and `recruit_recommend` contain PMC11 Person-first identity loading, but their original functions and write/read contracts remain in use. The older calls are not silently routed through `assistant`.

## Endpoint and caller inventory

| Legacy endpoint / action | Current caller and business scope | Current identity / data boundary | Person Gateway counterpart | Status and evidence |
| --- | --- | --- | --- | --- |
| `ai_followup.analyze_profile` | `admin.html` customer profile analysis; `customer_id` | Customer-rooted legacy profile analysis; PMC11 identity behavior should be verified per action before any cleanup | No equivalent `assistant` route found for this action | `LEGACY_ONLY`; active caller at `admin.html` customer profile section. Not migrated. |
| `ai_followup.analyze_recruit_profile` | `admin.html` recruit candidate analysis; `candidate_id` | Candidate-rooted legacy analysis | `assistant.recruitCoach` is a newer, separate candidate coaching task | `OVERLAP, NOT REPLACEMENT`; both contracts currently exist. Console Recruit Coach uses Person ID + Candidate ID; legacy action remains active. |
| `ai_followup.parse` | No direct `ai_followup` parse call found in this checkout; only `analyze_profile` and `analyze_recruit_profile` calls were found | Legacy customer-oriented parse contract remains implemented | No one-to-one Gateway operation found | `NO IN-REPO CALLER / EXTERNAL UNKNOWN`; retain endpoint. Do not infer globally unused from repository search. |
| `ai_referral` | `admin.html` customer referral suggestion; `customer_id` | Loads customer business context and PMC11 Person-first identity; returns a recommendation | No equivalent Gateway route found | `LEGACY_ONLY`; active caller. It returns a suggestion and is not the same as Person conversation playbook. |
| `ai_recommend` | `admin.html` follow-up recommendation generation | Legacy recommendation context; caller separately creates a recommendation record after generation | Person summary, meeting prep, playbook, and knowledge-library tasks are distinct contracts | `LEGACY_ONLY`; active caller, no verified replacement route. |
| `ai_recommendations` | `admin.html` list/create/edit/status flows for customer recommendations | Persists and updates `public.ai_recommendations`; includes user review/status flow | `assistant.personAIHistory` reads linked legacy advice in read-only history; `assistant.aiExperience` records separate review/outcome lineage | `SHARED DATA, LEGACY WRITES`; history/experience do not replace existing CRUD or make the table/function removable. |
| `ai_parse.parse` / `parse_import_draft` | `admin.html` customer data parsing; `person_360/file-import-service.js` invokes `parse_import_draft` for M08; Console also calls `ai_parse` for Quick Capture parsing and OCR parsing paths | Produces a draft; caller confirms before business save | No general Person Gateway replacement. Knowledge OCR is invoked by `assistant.knowledgeLibrary` but internally delegates to `ai_parse.ocr_knowledge_source` | `SHARED / MULTIPLE CONTRACTS`; preserve parse/import/OCR boundaries and draft confirmation. Parse output is not itself a confirmed business write. |
| `ai_parse.quick_capture` | `admin.html` Legacy Quick Capture; `crm/js/modules/console/write.js` calls `ai_parse` with `profile:'focused'` for Console Quick Capture | Pure parse; Console resolves the candidate with a server-side Person name resolver and presents a human choice before commit | `assistant.quickCaptureV2` is a distinct route and service; do not conflate it with the currently observed Console caller | `SHARED, IDENTITY CONFIRMATION REQUIRED`; AGENTS.md explicitly keeps existing Legacy Quick Capture behavior unchanged until separate approval. Preserve Console's server resolution and human choice boundary. |
| `ai_activity` legacy actions (`analyze`, `recommendSpeakers`, `recommendTopics`, `participantReview`, `postReview`, `learning`) | `admin.html` activity management; `crm/js/modules/activity-review-v2.js` also calls `postReviewV2` | Activity/participant/speaker/topic scope, not a Person-only workflow | Some V2 actions use Gateway tasks internally; the common function still dispatches legacy and V2 action contracts | `SHARED / MIXED VERSION`; not a PMC11 Person flow and not removable. Keep each action's existing semantics. |
| `recruit_score` | `admin.html` candidate scoring | Candidate lookup, Person-first identity where linked; writes `potential_score`, `potential_reason`, `updated_at` on `recruit_candidates` | `assistant.recruitCoach.generate` proposes a coaching assessment and does not write business data; `decision` binds human choice to a result | `OVERLAP, NOT REPLACEMENT`; different output and write boundary. Existing PMC12 tests cover score write fields and identity mapping. |
| `recruit_recommend` | `admin.html` candidate follow-up recommendation | Candidate scope, Person-first identity where linked; recommendation returned to existing caller | `assistant.recruitCoach` provides a versioned, candidate-bound coaching flow | `OVERLAP, NOT REPLACEMENT`; old caller remains active. Do not substitute without behavior/compat approval. |
| `policy_review_reports` | `admin.html` policy report generation, edit, remove | Customer policy-review report persistence and user edits | No Person Gateway equivalent found | `LEGACY_ONLY`; separate customer business process, outside PMC11 migration. |

The inventory is based on repository call-site search for `callFn(...)` and `api.call('assistant', ...)`, the `assistant` action dispatch table, Console data adapters, and corresponding tests. This is a source-level audit; it does not prove which UI is deployed to every user or whether external integrations call these Cloud Functions.

## Current Gateway route map

| Gateway operation | Identity/context | Persistence and human boundary | Automated coverage |
| --- | --- | --- | --- |
| `summarize` / `meetingPrep` | `personId`; context services load Person-scoped context and task subject | AI task/result history; generated output is shown to a person. Business data is not automatically written | `tests/pc33/ai-async-response.test.cjs`, `tests/pc33/meeting-prep-async.test.cjs`, `tests/pc33/summary-context.test.cjs`, `tests/pc33/person-ai-resilience.browser.cjs` |
| `conversationPlaybook` / history | `personId`; Person-centered conversation context | Versioned result/history; no automatic CRM business write | `tests/pc23/conversation-history.test.cjs`, `tests/pc23/playbook-details.browser.cjs`, `tests/pc33/person-ai-resilience.browser.cjs` |
| `personAIHistory` | Authenticated `personId`; verifies active Person, optionally resolves linked customer, returns supported Person tasks and read-only legacy recommendations | Read-only; Person task/result rows plus linked `ai_recommendations` source references | `tests/pc23/person-ai-history.test.cjs`, `tests/pc23/assistant-history-auth.test.cjs`, `tests/pc23/person-ai.browser.cjs` |
| `recruitCoach.generate/history/decision` | Authenticated route; explicit `personId` + `candidateId`; server loads candidate-scoped allowlisted context | Generation does not write business data; explicit human decision is bound to candidate and result | `tests/pc20/recruit-coach.test.cjs`, `tests/pc20/recruit-coach.browser.cjs` |
| `knowledgeLibrary.dualGenerate/adviceGenerate` | Person ID; context loaded through Person services; task subject is Person | Durable AI task/result and advice workflow; user selection/edit/confirmation controls downstream use; OCR source extraction delegates internally to `ai_parse.ocr_knowledge_source` | Knowledge library tests plus `tests/pc33/ai-async-response.test.cjs` and regression suites |
| `aiExperience` | Authenticated actor; validated result/event IDs | Explicit decision, outcome, learning and confirmation operations; strict server validation | `tests/pc29/ai-experience.test.cjs`, `tests/pc29/ai-experience.browser.cjs` |

`assistant` is an authenticated router. Person history has an explicit anonymous rejection test. The recruit coach service validates Person and candidate IDs, binds task subject to the candidate, scopes history and decisions, and returns `businessDataWritten:false` for generation. Task-status routing accepts an allowlist of task types and authenticates before dispatch. These tests provide evidence for the new flows, not for replacement of the Legacy callers above.

## Coverage gaps and follow-up

1. **No endpoint-wide replacement proof:** most active Legacy entry points have no corresponding Gateway route, and some are deliberately outside Person scope. The correct result is not to invent an equivalent route.
2. **Legacy identity audit is not complete for every action:** existing PMC11/PMC12 evidence covers Person-first identity adaptation in named legacy functions, but does not establish that every old AI action now uses Person identity or has the same fallback/conflict behavior.
3. **External consumers are unknown:** static repository search cannot rule out scheduled jobs, manual CloudBase invocation, or integrations outside this checkout.
4. **No behavior migration authorized:** no endpoint, Cloud Function, route, table, view, or caller was modified. Any proposed migration needs a concrete per-endpoint impact, compatibility and regression plan, followed by the required user approval before implementation.

Therefore keep `tests/pmc/pmc11-identity.test.cjs` as TODO. Close it only after the specific active Legacy paths are either (a) migrated through an approved change with compatibility and replacement tests, or (b) deliberately retained as Legacy and covered for their current Person identity fallback, writes, authorization, and error semantics. Do not mark the whole suite passed merely because the current Gateway tests pass.

## Verification boundary

- Source and test inventory only; no production reads/writes or Cloud Function invocations.
- No database changes; all references are explicitly `public` where schema is represented.
- No admin cleanup or Gateway behavior change.
- Task-appropriate regression should run the existing PMC11/PMC12, PC20, PC23, PC29, and PC33 test groups. Existing TODO remains an outstanding item, not a failure disguised as pass.
