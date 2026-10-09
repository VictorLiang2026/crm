-- PMC-16 q7: 软删/批次一致性 + ai_recommendations NBA 闭环状态分布（无 status 列，状态在 nba jsonb）
SELECT metric, cnt FROM (
  SELECT 'followups.softdel_no_batch' AS metric, count(*) AS cnt FROM public.followups WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'gifts.softdel_no_batch', count(*) FROM public.gifts WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'photos.softdel_no_batch', count(*) FROM public.photos WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'products.softdel_no_batch', count(*) FROM public.products WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'prr.softdel_no_batch', count(*) FROM public.policy_review_reports WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'ocr.softdel_no_batch', count(*) FROM public.ocr_records WHERE deleted_at IS NOT NULL AND delete_batch_id IS NULL
  UNION ALL SELECT 'ai_rec.nba_completed', count(*) FROM public.ai_recommendations WHERE nba->>'status' = 'completed'
  UNION ALL SELECT 'ai_rec.nba_skipped', count(*) FROM public.ai_recommendations WHERE nba->>'status' = 'skipped'
  UNION ALL SELECT 'ai_rec.nba_open', count(*) FROM public.ai_recommendations WHERE nba->>'status' IS NULL
  UNION ALL SELECT 'ai_rec.name_drift', count(*) FROM public.ai_recommendations x JOIN public.customers c ON c."Id" = x.customer_id WHERE x.customer_name IS DISTINCT FROM c.customer_name
  UNION ALL SELECT 'opportunities.referred_name_set', count(*) FROM public.opportunities WHERE referred_name IS NOT NULL
  UNION ALL SELECT 'products.null_customer_id', count(*) FROM public.products WHERE customer_id IS NULL
) m ORDER BY metric;
