-- WP11: repair only the two unmarked generated text fields of the registered fictional report.
DO $wp11$
DECLARE affected integer;
BEGIN
  UPDATE public.policy_review_reports AS r
  SET gaps_found = '【系统测试·勿联系】' || r.gaps_found,
      recommendations = '【系统测试·勿联系】' || r.recommendations
  WHERE r.id = 3 AND r.customer_id = 788 AND r.deleted_at IS NULL
    AND r.report_type = '【系统测试·勿联系】虚构保单检视'
    AND md5(r.gaps_found) = '3fdd3b1491893328c2fdaac4b5b001b8'
    AND md5(r.recommendations) = '4f1f44b4ab4bca5dd97404084d8d5607'
    AND EXISTS (
      SELECT 1 FROM public.crm_test_records AS t
      WHERE t.record_table = 'policy_review_reports' AND t.record_id = r.id::text
        AND t.batch_key = 'crm_test_main_v1' AND t.origin = 'derived'
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'WP11 report marker repair expected one registered fictional row, got %', affected; END IF;
END
$wp11$;
