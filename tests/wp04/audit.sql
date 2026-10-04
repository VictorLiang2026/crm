-- WP04: public-only reads. No names, contacts or complete test manifest in output.
WITH links AS (
 SELECT 'customers' AS kind,c."Id"::text AS id,
  CASE WHEN p.id IS NULL THEN 'UNMAPPED_CUSTOMER' WHEN p.deleted_at IS NOT NULL THEN 'PERSON_DELETED' END AS issue
 FROM public.customers c LEFT JOIN public.persons p ON p.legacy_customer_id=c."Id" WHERE c.deleted_at IS NULL
 UNION ALL
 SELECT 'recruits',r.id::text,
  CASE WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'INVALID_PERSON'
   WHEN r.customer_id IS NOT NULL AND (c."Id" IS NULL OR c.deleted_at IS NOT NULL) THEN 'INVALID_CUSTOMER'
   WHEN r.customer_id IS NOT NULL AND p.legacy_customer_id IS DISTINCT FROM r.customer_id THEN 'IDENTITY_CONFLICT' END
 FROM public.recruit_candidates r LEFT JOIN public.persons p ON p.id=r.person_id
 LEFT JOIN public.customers c ON c."Id"=r.customer_id WHERE r.deleted_at IS NULL
 UNION ALL
 SELECT 'speakers',s.id::text,
  CASE WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'INVALID_PERSON'
   WHEN s.customer_id IS NOT NULL AND (c."Id" IS NULL OR c.deleted_at IS NOT NULL OR p.legacy_customer_id IS DISTINCT FROM s.customer_id) THEN 'INVALID_CUSTOMER'
   WHEN s.recruit_candidate_id IS NOT NULL AND (r.id IS NULL OR r.deleted_at IS NOT NULL OR r.person_id IS DISTINCT FROM s.person_id) THEN 'IDENTITY_CONFLICT' END
 FROM public.activity_speakers s LEFT JOIN public.persons p ON p.id=s.person_id
 LEFT JOIN public.customers c ON c."Id"=s.customer_id
 LEFT JOIN public.recruit_candidates r ON r.id=s.recruit_candidate_id WHERE s.deleted_at IS NULL
 UNION ALL
 SELECT 'participants',a.id::text,
  CASE WHEN event.id IS NULL OR event.deleted_at IS NOT NULL THEN 'INVALID_ACTIVITY'
   WHEN a.person_type NOT IN ('person','customer','recruit','speaker') THEN 'UNKNOWN_TYPE'
   WHEN a.canonical_person_id IS NULL AND a.person_id IS NULL THEN 'NAME_ONLY_UNCONFIRMED'
   WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'INVALID_PERSON'
   WHEN a.person_id IS NOT NULL AND (
    CASE a.person_type WHEN 'person' THEN direct.id WHEN 'customer' THEN cp.id
     WHEN 'recruit' THEN r.person_id WHEN 'speaker' THEN s.person_id END IS DISTINCT FROM a.canonical_person_id
    OR CASE a.person_type WHEN 'customer' THEN c.deleted_at IS NOT NULL OR c."Id" IS NULL
     WHEN 'recruit' THEN r.deleted_at IS NOT NULL OR r.id IS NULL
     WHEN 'speaker' THEN s.deleted_at IS NOT NULL OR s.id IS NULL
     ELSE direct.deleted_at IS NOT NULL OR direct.id IS NULL END) THEN 'IDENTITY_CONFLICT' END
 FROM public.activity_participants a LEFT JOIN public.activities event ON event.id=a.activity_id
 LEFT JOIN public.persons p ON p.id=a.canonical_person_id
 LEFT JOIN public.persons direct ON a.person_type='person' AND direct.id=a.person_id
 LEFT JOIN public.customers c ON a.person_type='customer' AND c."Id"=a.person_id
 LEFT JOIN public.persons cp ON cp.legacy_customer_id=c."Id"
 LEFT JOIN public.recruit_candidates r ON a.person_type='recruit' AND r.id=a.person_id
 LEFT JOIN public.activity_speakers s ON a.person_type='speaker' AND s.id=a.person_id
 WHERE a.deleted_at IS NULL
), summary AS (
 SELECT k.kind,count(l.id) AS active,count(l.id) FILTER(WHERE l.issue IS NULL) AS mapped,
  count(l.id) FILTER(WHERE l.issue IS NOT NULL) AS exceptions
 FROM (VALUES('customers'),('recruits'),('speakers'),('participants')) k(kind)
 LEFT JOIN links l ON l.kind=k.kind GROUP BY k.kind
)
SELECT jsonb_build_object('version','wp04-v1','schema','public',
 'environment','crm-d1gkae8ddc930d151','observedAt',CURRENT_TIMESTAMP,
 'summary',(SELECT jsonb_agg(to_jsonb(s) ORDER BY kind) FROM summary s),
 'exceptions',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',id,'issue',issue) ORDER BY kind,id) FROM links WHERE issue IS NOT NULL),'[]'::jsonb),
 'initialTestRows',(SELECT count(*) FROM public.crm_test_records WHERE origin='initial')) AS snapshot;
