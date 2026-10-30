# 2026-10-30 S-13 PDF extraction recovery

## Scope

- Increase the Knowledge Library PDF page ceiling from 40 to 150 pages for text extraction and resumable three-page OCR batches.
- Preserve the 30,000,000-byte PDF cap and 100,000-character extracted-text cap.
- Return distinct safe errors for page-count, text-size, and parser-process resource limits. Add Simplified Chinese and English guidance to the Knowledge Library retry UI.
- No database, permission, storage-policy, or model-provider changes. Generated source content remains a draft for human review.

## Diagnosis

- The source is `public.knowledge_sources.id=13`, a 21,711,458-byte PDF. It is below the 30 MB extraction cap and 100 MB storage cap.
- The extraction request and two retry responses returned `PDF_LIMIT`. The row remained `extraction_status=failed`, `lifecycle_status=draft`; there is no active OCR job and no linked `public.knowledge_items` draft.
- Current server logs did not capture page count, extracted-text length, or parser child exit details, so the exact original limit branch cannot be recovered from those logs. The existing parser had a 40-page cap and 100,000-character cap, and mapped parser process aborts to the same `PDF_LIMIT` code.
- This change raises the page cap to cover the 124-page source and makes later failures distinguishable. If the text cap or worker resource limit is still reached, the UI now gives a specific next step.

## Baseline and impact

- Baseline commit/tag: `6151af511a13d3650d61d53c36a721ff7c9cdd6c` / `release-20261030-230058`.
- Before changes, local, GitHub `master`, online `admin.html`, 93 reachable static assets, 29 Cloud Functions and 236 source/config files matched.
- Only `assistant`, `crm/js/modules/console/knowledge-governance.js`, and `crm/js/modules/console/i18n.js` are in the deployment manifest.
- No migration or rollback SQL is needed. Code rollback uses the baseline tag and redeploys only `assistant` and the two changed static modules.

## Verification

- Targeted PDF/OCR tests: 21 passed.
- Knowledge Library tests: 63 passed.
- WP01: `PASS_WITH_LIMITATIONS`; 108 regression checks passed, 5 historical skips; 1,196 public catalog checks; anonymous checks 78/78; identity audit retains 3 documented exceptions; PC34 checks passed.
- Source syntax checks and `git diff --check` passed.
- The first integrated WP01 attempt hit a transient browser “No browser page target” in an unrelated PC34 Quick Capture test; PC34 passed standalone and in the subsequent successful WP01 run.

## Publication

- Deployed only Cloud Function `assistant` and static assets `crm/js/modules/console/knowledge-governance.js`, `crm/js/modules/console/i18n.js`.
- Post-deployment `sync-check.ps1 -CloudOnly` passed: 29 functions / 237 source-config files and 93 reachable page/module/style assets match cloud.
- A safe `assistant` invocation returned expected `UNAUTHORIZED` before knowledge access; it did not create or update a record.
- The user's retry against the earlier 120-page deployment returned the expected page-limit guidance for the 124-page source. After this 150-page deployment, S-13 still needs one retry through the authenticated CRM UI. Management invocation has no authenticated end-user identity; source ownership is not bypassed. Generated content remains a draft requiring human review.

## Remaining limits

- The user confirmed the PDF has 124 pages. Files above the new 150-page cap or above the retained 100,000-character limit will receive a specific error.
- The 256 MB function memory configuration is unchanged. Parser-process failures now report separately so they are not mistaken for an input-size limit.
