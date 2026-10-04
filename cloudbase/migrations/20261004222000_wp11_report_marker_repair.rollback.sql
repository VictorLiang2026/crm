-- WP11: remove only the prefixes added by the paired repair, if the row has not changed again.
DO $wp11$
DECLARE affected integer;
BEGIN
  UPDATE public.policy_review_reports AS r
  SET gaps_found = substring(r.gaps_found FROM char_length('【系统测试·勿联系】') + 1),
      recommendations = substring(r.recommendations FROM char_length('【系统测试·勿联系】') + 1)
  WHERE r.id = 3 AND r.customer_id = 788 AND r.deleted_at IS NULL
    AND r.report_type = '【系统测试·勿联系】虚构保单检视'
    AND left(r.gaps_found, char_length('【系统测试·勿联系】')) = '【系统测试·勿联系】'
    AND left(r.recommendations, char_length('【系统测试·勿联系】')) = '【系统测试·勿联系】'
    AND md5(substring(r.gaps_found FROM char_length('【系统测试·勿联系】') + 1)) = '3fdd3b1491893328c2fdaac4b5b001b8'
    AND md5(substring(r.recommendations FROM char_length('【系统测试·勿联系】') + 1)) = '4f1f44b4ab4bca5dd97404084d8d5607';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'WP11 report marker rollback refused changed row, got %', affected; END IF;
END
$wp11$;
