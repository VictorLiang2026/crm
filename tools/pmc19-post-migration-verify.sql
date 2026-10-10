SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='recruit_candidates' AND column_name='education') AS edu_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='recruit_candidates' AND column_name='mbti') AS mbti_exists,
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='customers' AND constraint_name='客户列表_姓名_key') AS constraint_exists,
  (SELECT COUNT(*) FROM public.customers) AS customers_total,
  (SELECT COUNT(*) FROM public.recruit_candidates) AS recruit_total;
