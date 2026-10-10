SELECT c."Id" AS id, p.display_name AS name,
  (SELECT count(*) FROM followups f WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL) AS followups,
  (SELECT count(*) FROM gifts g WHERE g.customer_id = c."Id" AND g.deleted_at IS NULL) AS gifts,
  (SELECT count(*) FROM photos ph WHERE ph.customer_id = c."Id" AND ph.deleted_at IS NULL) AS photos,
  (SELECT count(*) FROM products pr WHERE pr.customer_id = c."Id") AS products
FROM customers c
JOIN persons p ON p.id = c.person_id
WHERE c.deleted_at IS NULL
ORDER BY (SELECT count(*) FROM followups f WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL) DESC,
         (SELECT count(*) FROM gifts g WHERE g.customer_id = c."Id" AND g.deleted_at IS NULL) DESC
LIMIT 3;
