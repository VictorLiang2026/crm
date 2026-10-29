# 2026-10-29 Knowledge PDF OCR queue

## Scope

- Scanned PDFs enter a persistent queue after the text layer is checked. Text-layer PDFs keep the existing direct extraction flow.
- The existing private public.knowledge_sources.metadata.ocr_job stores stage, page cursor, page count, completed OCR text, retry count, and a short lease. No table, column, view, RPC, or RLS change is introduced.
- Each timer invocation renders/OCRs at most three pages using the existing ai_parse vision route. It checkpoints before returning; subsequent invocations resume at the next page. Summary generation continues through the existing AI Gateway and draft flow.
- The Knowledge Library shows page progress, refreshes while queued work is active, and distinguishes OCR from summary generation. Retry resumes the saved cursor. OCR scratch text is removed after draft creation.
- Deletion of a source in extracting state is rejected. Existing upload, storage, text-layer extraction, review, and human mark-active behavior remain.
- Assistant timeout is 180 seconds. A bounded worker timeout and at most three-page batch keep one invocation within that limit. PDF caps stay 30 MB / 40 pages.
- A one-minute timer is declared for assistant; its custom argument is a random secret held only in CloudBase runtime configuration. The exact timer event, trigger name, and secret must all match before internal processing is allowed. User-shaped timer requests still require ordinary login.

## Data and recovery

- All database access remains explicitly in public; no migration is needed.
- Source files remain in the existing private knowledge bucket or legacy source storage. OCR text exists only in the private source row's temporary job metadata and is removed when the draft is generated.
- Stop the timer trigger first to pause processing. Restore the prior assistant code/config and the affected /crm/js/modules/console/ files from the preceding release tag to roll back. Do not remove queue metadata; it can be resumed by redeploying the new worker and re-enabling the trigger.
- The timer invokes once a minute while idle. This creates low, predictable idle invocation volume.

## Regression

- Focused OCR and Knowledge Library tests: `node --test tests/knowledge-library/*.test.cjs tests/assistant/knowledge-ocr-timer.test.cjs tests/pc22/knowledge-governance.browser.cjs` — 49 passed, 0 failed.
- Full repository regression gate: `npm run check:release-gate` — PASS_WITH_LIMITATIONS. Catalog audit: 1,166 checks, 0 failures; anonymous read-only probes: 77/77; full regression: 108 passed, 0 failed, 5 skipped.
- WP04 identity audit has three pre-existing name-only activity participants awaiting identity confirmation; no data was changed.
- Open non-blocking acceptance items: manual login, service-runtime probe, production writes / AI, and mobile. This release does not perform production AI writes; the iPad UI is checked by the existing browser suite.
- Shared copies were checked: 58 copies across 29 functions match. No shared module was changed by this work package.

## Publication

The assistant code upload succeeded. After adding the approved MCP guard setting and restarting Codex, the assistant timeout is 180 seconds and the runtime OCR secret is configured. The timer was created through the documented SCF API because the simplified CloudBase trigger action drops `CustomArgument`; the CreateTrigger response confirmed it matched the runtime secret. Initial timer runs exposed missing `TCB_ENV` and returned `INVALID_CONFIG`. With user confirmation, `TCB_ENV` was added while preserving existing function variables. The authenticated one-minute timer was recreated; its first post-fix invocation returned status 200 / retCode 0. No OCR queue item was processed during that invocation.

The three changed Knowledge Library modules have been uploaded to static hosting. The existing S-10 source row is still `failed`; it requires the user-facing retry action to requeue extraction, after which the timer can process it. No Git commit, tag, or GitHub push has been made yet. The project MCP configuration includes `CLOUDBASE_MCP_SKIP_CREDENTIAL_GUARD=manageFunctions.updateFunctionConfig`; the restarted connection applied the approved function configuration. Remaining release work: verify all three hosted module hashes, run CloudOnly/full sync checks, and complete the master GitHub release.

