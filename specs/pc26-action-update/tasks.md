# PC26 implementation tasks

- [x] 1. Extend the Action command and configured-model parser contract with bounded update/close proposals while preserving create and login routing.
- [x] 2. Add paired `public` migrations/rollbacks and transaction-safe server preview/confirm/execute branches; verify against registered fictional fixtures. An initial transaction probe caught a missing empty draft on close; corrective migration `20261017193000` fixed it and the final transaction passed with all fixture changes rolled back.
- [x] 3. Add bilingual iPad-first Person/Action selection, authoritative before/after preview, disclosure notice and explicit confirmation UI; retain create and PC06 manual flows.
- [x] 4. Cover server, SQL and browser regression, including stale/forged/cross-Person/replay/failure paths and neighboring legacy Action/Today flows.
- [x] 5. Deploy only affected function/static assets, apply and verify migrations, publish GitHub/tag, and verify Local/GitHub/CloudBase consistency. GitHub push/tag and final Local/GitHub/CloudBase sync verification are completed by the release script and post-release sync check.
