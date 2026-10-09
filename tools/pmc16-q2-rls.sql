-- PMC-16 q2: 目标表 RLS 策略盘点（附件/审计权限面）
SELECT tablename, policyname, permissive, roles::text, cmd,
       left(coalesce(qual,''), 160) AS qual, left(coalesce(with_check,''), 160) AS with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('interactions','followups','opportunities','actions','commitments',
                    'products','policy_review_reports','gifts','photos','ocr_records','ai_recommendations',
                    'ai_tasks','ai_runs','ai_results')
ORDER BY tablename, policyname;
