-- PMC-16 q4: 客户子表视图定义（customer_name 等身份字段读来源）
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
  AND viewname IN ('followups_view','gifts_view','photos_view','products_view','ai_recommendations_view','customers_view','policy_review_reports_view','ocr_records_view')
ORDER BY viewname;
