WITH probe(domain, metric, value) AS (
  SELECT 'person', 'persons_total', count(*)::text FROM persons
  UNION ALL SELECT 'person', 'persons_active', count(*)::text FROM persons WHERE deleted_at IS NULL
  UNION ALL SELECT 'person', 'persons_without_customer(person_only)', count(*)::text FROM persons p
    WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.person_id = p.id)
  UNION ALL SELECT 'customer', 'customers_total', count(*)::text FROM customers
  UNION ALL SELECT 'customer', 'customers_active', count(*)::text FROM customers WHERE deleted_at IS NULL
  UNION ALL SELECT 'customer', 'active_customers_missing_person_id', count(*)::text FROM customers
    WHERE deleted_at IS NULL AND person_id IS NULL
  UNION ALL SELECT 'customer', 'customers_person_id_duplicates', count(*)::text FROM (
    SELECT person_id FROM customers WHERE person_id IS NULL AND FALSE) z
  UNION ALL SELECT 'customer', 'customers_person_id_multiplicity_gt1', count(*)::text FROM (
    SELECT person_id FROM customers WHERE deleted_at IS NULL GROUP BY person_id HAVING count(*) > 1) z
  UNION ALL SELECT 'recruit', 'candidates_total', count(*)::text FROM recruit_candidates
  UNION ALL SELECT 'recruit', 'candidates_active', count(*)::text FROM recruit_candidates WHERE deleted_at IS NULL
  UNION ALL SELECT 'recruit', 'active_candidates_missing_customer_and_person', count(*)::text FROM recruit_candidates rc
    WHERE rc.deleted_at IS NULL AND rc.person_id IS NULL AND rc.customer_id IS NULL
  UNION ALL SELECT 'recruit', 'active_candidates_customer_link_broken', count(*)::text FROM recruit_candidates rc
    WHERE rc.deleted_at IS NULL AND rc.customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = rc.customer_id)
  UNION ALL SELECT 'recruit', 'active_candidates_person_link_broken', count(*)::text FROM recruit_candidates rc
    WHERE rc.deleted_at IS NULL AND rc.person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = rc.person_id)
  UNION ALL SELECT 'speaker', 'speakers_total', count(*)::text FROM activity_speakers
  UNION ALL SELECT 'speaker', 'speakers_active', count(*)::text FROM activity_speakers WHERE deleted_at IS NULL
  UNION ALL SELECT 'speaker', 'active_speakers_person_link_broken', count(*)::text FROM activity_speakers s
    WHERE s.deleted_at IS NULL AND s.person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = s.person_id)
  UNION ALL SELECT 'participant', 'participants_total', count(*)::text FROM activity_participants
  UNION ALL SELECT 'participant', 'participants_active', count(*)::text FROM activity_participants WHERE deleted_at IS NULL
  UNION ALL SELECT 'participant', 'active_participants_canonical_link_broken', count(*)::text FROM activity_participants ap
    WHERE ap.deleted_at IS NULL AND ap.canonical_person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = ap.canonical_person_id)
  UNION ALL SELECT 'participant', 'active_without_canonical(snapshot_only_d6)', count(*)::text FROM activity_participants
    WHERE deleted_at IS NULL AND canonical_person_id IS NULL
  UNION ALL SELECT 'relationship', 'relationships_total', count(*)::text FROM relationships
  UNION ALL SELECT 'relationship', 'relationships_active', count(*)::text FROM relationships WHERE deleted_at IS NULL
  UNION ALL SELECT 'relationship', 'active_link_broken', count(*)::text FROM relationships r
    WHERE r.deleted_at IS NULL AND (
      NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = r.from_person_id)
      OR NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = r.to_person_id))
  UNION ALL SELECT 'family', 'households_total', count(*)::text FROM households
  UNION ALL SELECT 'family', 'households_active', count(*)::text FROM households WHERE deleted_at IS NULL
  UNION ALL SELECT 'family', 'members_total', count(*)::text FROM household_members
  UNION ALL SELECT 'family', 'members_active', count(*)::text FROM household_members WHERE deleted_at IS NULL
  UNION ALL SELECT 'family', 'active_members_person_broken', count(*)::text FROM household_members hm
    WHERE hm.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = hm.person_id)
  UNION ALL SELECT 'interaction', 'interactions_total', count(*)::text FROM interactions
  UNION ALL SELECT 'interaction', 'interactions_person_broken', count(*)::text FROM interactions i
    WHERE NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = i.person_id)
  UNION ALL SELECT 'interaction', 'followups_active', count(*)::text FROM followups WHERE deleted_at IS NULL
  UNION ALL SELECT 'interaction', 'followups_customer_broken', count(*)::text FROM followups f
    WHERE f.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = f.customer_id)
  UNION ALL SELECT 'action', 'actions_total', count(*)::text FROM actions
  UNION ALL SELECT 'action', 'actions_open', count(*)::text FROM actions WHERE status = 'open'
  UNION ALL SELECT 'action', 'actions_person_broken', count(*)::text FROM actions a
    WHERE NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = a.person_id)
  UNION ALL SELECT 'gift', 'gifts_active', count(*)::text FROM gifts WHERE deleted_at IS NULL
  UNION ALL SELECT 'gift', 'gifts_customer_broken', count(*)::text FROM gifts g
    WHERE g.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = g.customer_id)
  UNION ALL SELECT 'attachment', 'photos_active', count(*)::text FROM photos WHERE deleted_at IS NULL
  UNION ALL SELECT 'attachment', 'photos_customer_broken', count(*)::text FROM photos ph
    WHERE ph.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = ph.customer_id)
  UNION ALL SELECT 'product', 'products_active', count(*)::text FROM products WHERE deleted_at IS NULL
  UNION ALL SELECT 'product', 'products_customer_broken', count(*)::text FROM products pr
    WHERE pr.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = pr.customer_id)
  UNION ALL SELECT 'ai', 'ai_recommendations_total', count(*)::text FROM ai_recommendations
  UNION ALL SELECT 'ai', 'ai_recommendations_customer_broken', count(*)::text FROM ai_recommendations ar
    WHERE ar.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = ar.customer_id)
  UNION ALL SELECT 'ai', 'ocr_records_total', count(*)::text FROM ocr_records
  UNION ALL SELECT 'ai', 'ocr_customer_broken', count(*)::text FROM ocr_records o
    WHERE o.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c."Id" = o.customer_id)
  UNION ALL SELECT 'trash', 'customers_deleted', count(*)::text FROM customers WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'trash', 'persons_deleted', count(*)::text FROM persons WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'trash', 'recruit_candidates_deleted', count(*)::text FROM recruit_candidates WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'trash', 'followups_deleted', count(*)::text FROM followups WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'view', 'customers_view', count(*)::text FROM customers_view
  UNION ALL SELECT 'view', 'followups_view', count(*)::text FROM followups_view
  UNION ALL SELECT 'view', 'gifts_view', count(*)::text FROM gifts_view
  UNION ALL SELECT 'view', 'photos_view', count(*)::text FROM photos_view
  UNION ALL SELECT 'view', 'products_view', count(*)::text FROM products_view
  UNION ALL SELECT 'view', 'ai_recommendations_view', count(*)::text FROM ai_recommendations_view
  UNION ALL SELECT 'view', 'v_action_center', count(*)::text FROM v_action_center
  UNION ALL SELECT 'view', 'v_funnel_stats_rows', count(*)::text FROM v_funnel_stats
  UNION ALL SELECT 'view', 'v_recruit_candidates', count(*)::text FROM v_recruit_candidates
  UNION ALL SELECT 'view', 'v_recruit_candidates_trash', count(*)::text FROM v_recruit_candidates_trash
  UNION ALL SELECT 'view', 'v_recruit_candidates_person_only', count(*)::text FROM v_recruit_candidates_person_only
  UNION ALL SELECT 'view', 'v_recruit_candidates_person_only_trash', count(*)::text FROM v_recruit_candidates_person_only_trash
)
SELECT domain, metric, value FROM probe ORDER BY domain, metric;
