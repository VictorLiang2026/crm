SELECT v.table_name AS view_name
FROM information_schema.views v
WHERE v.table_schema = 'public'
ORDER BY 1;
