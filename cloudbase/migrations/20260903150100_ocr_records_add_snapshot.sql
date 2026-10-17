-- Add customer_snapshot column to ocr_records for AI parse rollback
ALTER TABLE ocr_records ADD COLUMN IF NOT EXISTS customer_snapshot text;
COMMENT ON COLUMN ocr_records.customer_snapshot IS 'AI 解析前客户信息快照（JSON），删除本记录时可据此恢复客户信息';
