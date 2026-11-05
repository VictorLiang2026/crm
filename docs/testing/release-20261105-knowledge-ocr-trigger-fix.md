# 2026-11-05 Knowledge OCR recovery and retry repair

## Cause and scope

- Production `assistant` had the existing `knowledgeOcrWorker` timer enabled every minute, but the SCF trigger contained only the cron expression and no `CustomArgument` message.
- The assistant already requires the timer event's `Message` to exactly equal `KNOWLEDGE_OCR_TRIGGER_SECRET`. With an empty message, scheduled calls fell through to the ordinary assistant router and returned `INVALID_INTENT` in 1–3 ms; neither PDF was processed.
- The non-sensitive cron remains declared in `cloudbaserc.json`; the runtime secret is not committed. Any timer created/recreated without setting SCF `CustomArgument` from the existing CloudBase environment secret will be inert again.
- The follow-up implementation was approved after the first run showed that the trigger repair alone was insufficient: S-29's summary had transient AI errors and S-33's three-page batch exceeded the function timeout. A second approval authorized chunked summarization after both full OCR texts still timed out in the AI summary stage.
- Scope stayed within the user's approval: preserve OCR checkpoints, retry transient OCR/AI failures with bounded exponential backoff, split long summary input into individually checkpointed chunks, then resume only S-29/S-33. No model configuration, schema, permissions, or unrelated records were changed. Draft review/publishing remains human-controlled.

## Repair and production result

- Used SCF `UpdateTrigger` in `ap-shanghai` on `assistant / knowledgeOcrWorker`, setting `CustomArgument` from the existing runtime secret. The timer name and one-minute cron were preserved; no secret was printed or stored in Git.
- Production logs now show long-running OCR worker calls instead of `INVALID_INTENT`, confirming the timer gate is working.
- Requirement correction: the intended OCR preference is larger, longer batches. The initial one-page limit was overly conservative and is replaced by adaptive batches, up to the `ai_parse` limit of three images per request. A transient timeout shrinks the next retry from 3→2→1 pages; after three successful batches at the smaller size, the worker probes the next larger size again. This changes future scanned-PDF throughput only; the completed S-29/S-33 drafts are not reprocessed.
- Each successful OCR batch advances the existing `next_page` cursor and appends to the existing OCR text. Transient failures (`AI_RETRY_LATER`, `AI_IN_PROGRESS`, `RATE_LIMIT`, `PDF_TIMEOUT`, function timeouts, and upstream unavailable) retain the cursor/text and retry up to 10 attempts using exponential delays capped at 15 minutes. Non-transient errors keep the existing five-attempt limit. Exhausted retries mark extraction failed while retaining OCR text for recovery.
- Long OCR text is split into overlapping 1,500-character chunks. Each queue invocation summarizes one chunk using a 100-second AI Gateway timeout (within the existing function limit), then checkpoints its summary, cursor, and AI task/result IDs. Once all chunks complete, the existing draft creation path writes one knowledge item and keeps it unverified for human review. Short-document extraction remains on its existing single-call path.
- Deployed only the existing `assistant` CloudBase function through `tools/deploy-function.ps1 -Function assistant`; no static page or other function was deployed.
- Requeued only `public.knowledge_sources.id IN (29,33)` after checking both were failed, non-deleted, and had no associated `public.knowledge_items`. The update reset only extraction status and retry/lease/error bookkeeping; it retained OCR text, stage, page count, and page cursor.
- Recovery result: S-29's 28/28 OCR pages and S-33's 13/13 OCR pages were retained. After transient whole-document and initial-segment timeouts, both records completed the approved 1,500-character segmented summary path. `public.knowledge_items` now contains exactly one active row for each source: S-29 → item 12 (6 summary task IDs), S-33 → item 13 (10 summary task IDs). Both items have `verified=false`, `lifecycle_status='draft'`, and remain for human review; neither was published or marked valid.
- A successful worker run creates an unreviewed draft only. It does not publish the knowledge item; a person must review and approve it.

## Regression

- Focused Knowledge Library/OCR and timer suite before chunked-summary extension: 8 passed, 0 failed.
- Full Knowledge Library suite after adaptive batching: 96 passed, 0 failed.
- Focused OCR queue suite after adaptive batching: 8 passed, 0 failed.
- AI Gateway suite: 18 passed, 0 failed.
- WP01 release gate on clean master baseline: `PASS_WITH_LIMITATIONS`; 108 regression checks passed, 0 failed, 5 existing skips; 81/81 anonymous permission probes passed; public catalog audit 1,248 checks passed; WP04 identity audit retained 3 documented legacy participant exceptions.
- Existing open gate limitations: interactive login, service-runtime writes, production business writes, and real mobile visual acceptance were not part of this repair.
- CloudBase code review: manually confirmed the worker remains internal-only, no secret is returned/logged, all affected data references are explicitly `public`, and no schema changes were made.
- Production business verification is limited to the two authorized records; no real customer records or unrelated knowledge sources were used.
- CloudOnly verification after adaptive-batch deployment: 96 page/module/style assets and all 30 functions / 243 source/config files matched, including `assistant`; no static page changed. This check verifies CloudBase source only; GitHub synchronization follows in the release step.
- Final S-29/S-33 status is recorded above; this follow-up does not reprocess or change those records.

## Rollback

- To pause OCR, close the existing timer trigger or clear its `CustomArgument` via SCF `UpdateTrigger`. Keep source rows and OCR job metadata; do not delete the uploaded PDF or any generated text. Resuming requires setting the custom argument from the runtime secret again.

## Publication

- Adaptive-batch deployment and CloudOnly verification are complete. Master commit/tag and GitHub synchronization are pending.
