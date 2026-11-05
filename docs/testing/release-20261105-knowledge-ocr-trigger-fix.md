# 2026-11-05 Knowledge OCR timer trigger repair

## Cause and scope

- Production `assistant` had the existing `knowledgeOcrWorker` timer enabled every minute, but the SCF trigger contained only the cron expression and no `CustomArgument` message.
- The assistant already requires the timer event's `Message` to exactly equal `KNOWLEDGE_OCR_TRIGGER_SECRET`. With an empty message, scheduled calls fell through to the ordinary assistant router and returned `INVALID_INTENT` in 1–3 ms; neither PDF was processed.
- The non-sensitive cron remains declared in `cloudbaserc.json`; the runtime secret is not committed. Any timer created/recreated without setting SCF `CustomArgument` from the existing CloudBase environment secret will be inert again.
- Scope stayed within the user's approval: set the trigger message and let the existing worker process S-29/S-33. No source code, model configuration, schema, permissions, or data outside these public knowledge records was changed. Draft review/publishing remains human-controlled.

## Repair and production result

- Used SCF `UpdateTrigger` in `ap-shanghai` on `assistant / knowledgeOcrWorker`, setting `CustomArgument` from the existing runtime secret. The timer name and one-minute cron were preserved; no secret was printed or stored in Git.
- Production logs now show long-running OCR worker calls instead of `INVALID_INTENT`, confirming the timer gate is working.
- At the post-release public-only verification, S-29 had extracted all 28 pages but its summary failed with `AI_RETRY_LATER` five times; it is `failed` and has no knowledge draft. Its extracted OCR text remains in the source job metadata for recovery.
- S-33 stopped at the page 7 cursor after five failed three-page `ai_parse` attempts at the function's 120-second timeout. It is `failed` and has no knowledge draft; extracted OCR text for prior pages remains in job metadata.
- Both rows are now outside the worker's active queue, and no `public.knowledge_items` rows were created for either source. The trigger fix is effective. Completing these two drafts requires a separate change to OCR batch size and transient-summary retry behavior. That behavior change was presented for approval and has not been implemented pending the user's response.

## Regression

- Focused Knowledge Library/OCR suite: 87 passed, 0 failed.
- WP01 release gate on clean master baseline: `PASS_WITH_LIMITATIONS`; 108 regression checks passed, 0 failed, 5 existing skips; 81/81 anonymous permission probes passed; public catalog audit 1,248 checks passed; WP04 identity audit retained 3 documented legacy participant exceptions.
- Existing open gate limitations: interactive login, service-runtime writes, production business writes, and real mobile visual acceptance were not part of this repair.
- CloudOnly source comparison: pending final result. No page or function code changed; runtime timer configuration is verified separately from source hashes.

## Rollback

- To pause OCR, close the existing timer trigger or clear its `CustomArgument` via SCF `UpdateTrigger`. Keep source rows and OCR job metadata; do not delete the uploaded PDF or any generated text. Resuming requires setting the custom argument from the runtime secret again.

## Publication

- Pending master commit/tag and post-publication CloudBase/GitHub sync verification. No code package or static page needs deployment for this configuration-only repair.
