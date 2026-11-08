# 2026-11-09 GPT legacy WeChat section recovery

## Change

- The assistant knowledge-library service now accepts legacy GPT advice separators that use a newline, a horizontal rule, and a `微信沟通话术：` label. It trims separator whitespace and returns `productAdvice` and `messageDraft` separately at read time.
- The existing paired advice view renders the three sections from that response, and the communication-script dialog uses the same `messageDraft` field. No UI code, database schema, or customer records changed.
- Explicit GPT save and human-confirmation behavior remain unchanged.

## Verification

- `node --check cloudfunctions/assistant/knowledge-library-service.js` passed.
- Targeted follow-up service and browser tests: 29 passed.
- `npm run test:modular` passed.
- `npm run test:knowledge-library`: 101 passed.
- `npm run test:wp04`: 8 passed; three previously declared participant identity exceptions remain.
- `npm run test:wp01`: 104 regression checks passed, 0 failed, 5 documented skips; release gate `PASS_WITH_LIMITATIONS`. Login, production writes, AI execution, and real mobile visual acceptance remain unverified.
- Before deployment, `sync-check.ps1 -CloudOnly` found the page and all 95 reachable assets in sync. The only code difference was the intended `assistant/knowledge-library-service.js` change; all other deployed CRM functions matched.

## Scope and recovery

- Deployment scope: only CloudBase function `assistant`; no database migration or static page upload.
- Rollback: redeploy the assistant source from the release immediately before this change. No database or customer-data rollback is needed.
- Production real-person advice generation was not performed as part of verification.
