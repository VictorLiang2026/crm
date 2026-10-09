-- PMC-16 q6: 附件归属体检——photos 文件引用、ocr_records file_ids 指向缺失 photos 的孤儿附件
SELECT metric, cnt FROM (
  SELECT 'photos.with_file_name' AS metric, count(*) AS cnt FROM public.photos WHERE file_name IS NOT NULL
  UNION ALL SELECT 'photos.soft_deleted', count(*) FROM public.photos WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'ocr.with_file_ids', count(*) FROM public.ocr_records WHERE file_ids IS NOT NULL AND file_ids <> '' AND file_ids <> '[]'
  UNION ALL SELECT 'ocr.file_orphan_rows', count(DISTINCT o.id) FROM public.ocr_records o
             CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN o.file_ids ~ '^\[' THEN o.file_ids::jsonb ELSE '[]'::jsonb END) fid(x)
             LEFT JOIN public.photos p ON p.id = fid.x::bigint AND p.deleted_at IS NULL
             WHERE o.deleted_at IS NULL AND p.id IS NULL
  UNION ALL SELECT 'recruit.radar_images', count(*) FROM public.recruit_candidates WHERE radar_image_name IS NOT NULL
  UNION ALL SELECT 'recruit.winner_reports', count(*) FROM public.recruit_candidates WHERE winner_report_name IS NOT NULL
) m ORDER BY metric;
