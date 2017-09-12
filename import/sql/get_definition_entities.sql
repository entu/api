SELECT
    NULLIF(LOWER(TRIM(REPLACE(keyname, '-', '_'))), '') AS _mid
FROM entity_definition
WHERE keyname NOT LIKE 'conf-%'
UNION SELECT
    NULLIF(LOWER(TRIM(REPLACE(keyname, '-', '_'))), '') AS _mid
FROM property_definition
WHERE keyname NOT LIKE 'conf-%'
AND dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
ORDER BY _mid;
