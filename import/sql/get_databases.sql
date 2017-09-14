SELECT DISTINCT TABLE_SCHEMA AS db
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN (
    'information_schema',
    'mysql',
    'performance_schema',
    'sys'
)
AND TABLE_SCHEMA IN ('tftak')
ORDER BY TABLE_SCHEMA;
