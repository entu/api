SELECT
    NULLIF(LOWER(TRIM(REPLACE(keyname, '-', '_'))), '') AS _mid,
    NULL AS _access
FROM entity_definition
WHERE keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
UNION SELECT
    NULLIF(LOWER(TRIM(REPLACE(keyname, '-', '_'))), '') AS _mid,
    NULL AS _access
FROM property_definition
WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
ORDER BY _mid;
