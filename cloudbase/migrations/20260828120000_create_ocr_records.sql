CREATE TABLE IF NOT EXISTS ocr_records (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL,
  summary text,
  raw_text text,
  file_ids text,
  file_names text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ocr_records_customer ON ocr_records (customer_id, created_at DESC);
