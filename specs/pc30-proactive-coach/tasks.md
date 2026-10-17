# PC30 implementation plan

- [x] 1. Add the paired `public` decision-state migration/rollback and least-privilege RPC; deploy migration `20261017232000` and verify live public catalog grants/RLS.
- [x] 2. Implement bounded deterministic signal aggregation, source validation, dedupe, and server-side decision handling.
- [x] 3. Add the iPad-first bilingual Today coach panel and integrate the existing WorkItem preview/execute flow.
- [x] 4. Add fictional migration-contract/service/browser regressions for all signal families, decision persistence, source failures, and test-data provenance. No live business-row write was used.
- [ ] 5. Run adjacent regressions and release gates; deploy only affected functions and Console assets; publish GitHub master/tag and verify local/GitHub/CloudBase consistency.
