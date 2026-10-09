-- PMC-16 q3: 行数、软删与孤儿引用体检（UNION 单语句）
SELECT metric, cnt FROM (
  SELECT 'interactions.total' AS metric, count(*) AS cnt FROM public.interactions
  UNION ALL SELECT 'interactions.orphan_person', count(*) FROM public.interactions i LEFT JOIN public.persons p ON p.id = i.person_id WHERE p.id IS NULL
  UNION ALL SELECT 'interactions.legacy_source_rows', count(*) FROM public.interactions WHERE source_type IN ('followups','recruit_followups','activity_participants')
  UNION ALL SELECT 'followups.total', count(*) FROM public.followups
  UNION ALL SELECT 'followups.soft_deleted', count(*) FROM public.followups WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'followups.orphan_customer', count(*) FROM public.followups f LEFT JOIN public.customers c ON c."Id" = f.customer_id WHERE c."Id" IS NULL
  UNION ALL SELECT 'followups.name_drift', count(*) FROM public.followups f JOIN public.customers c ON c."Id" = f.customer_id WHERE f.customer_name IS DISTINCT FROM c.customer_name
  UNION ALL SELECT 'opportunities.total', count(*) FROM public.opportunities
  UNION ALL SELECT 'opportunities.soft_deleted', count(*) FROM public.opportunities WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'opportunities.person_only', count(*) FROM public.opportunities WHERE person_id IS NOT NULL AND customer_id IS NULL
  UNION ALL SELECT 'opportunities.customer_linked', count(*) FROM public.opportunities WHERE customer_id IS NOT NULL
  UNION ALL SELECT 'actions.total', count(*) FROM public.actions
  UNION ALL SELECT 'actions.orphan_person', count(*) FROM public.actions a LEFT JOIN public.persons p ON p.id = a.person_id WHERE p.id IS NULL
  UNION ALL SELECT 'commitments.total', count(*) FROM public.commitments
  UNION ALL SELECT 'commitments.orphan_person', count(*) FROM public.commitments cm LEFT JOIN public.persons p ON p.id = cm.person_id WHERE p.id IS NULL
  UNION ALL SELECT 'products.total', count(*) FROM public.products
  UNION ALL SELECT 'products.orphan_customer', count(*) FROM public.products x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE x.customer_id IS NOT NULL AND c."Id" IS NULL
  UNION ALL SELECT 'policy_review_reports.total', count(*) FROM public.policy_review_reports
  UNION ALL SELECT 'prr.orphan_customer', count(*) FROM public.policy_review_reports x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE c."Id" IS NULL
  UNION ALL SELECT 'gifts.total', count(*) FROM public.gifts
  UNION ALL SELECT 'gifts.orphan_customer', count(*) FROM public.gifts x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE c."Id" IS NULL
  UNION ALL SELECT 'photos.total', count(*) FROM public.photos
  UNION ALL SELECT 'photos.orphan_customer', count(*) FROM public.photos x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE c."Id" IS NULL
  UNION ALL SELECT 'ocr_records.total', count(*) FROM public.ocr_records
  UNION ALL SELECT 'ocr_records.orphan_customer', count(*) FROM public.ocr_records x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE c."Id" IS NULL
  UNION ALL SELECT 'ocr_records.with_snapshot', count(*) FROM public.ocr_records WHERE customer_snapshot IS NOT NULL
  UNION ALL SELECT 'ai_recommendations.total', count(*) FROM public.ai_recommendations
  UNION ALL SELECT 'ai_recommendations.orphan_customer', count(*) FROM public.ai_recommendations x LEFT JOIN public.customers c ON c."Id" = x.customer_id WHERE c."Id" IS NULL
) m
ORDER BY metric;
