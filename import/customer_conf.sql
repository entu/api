SELECT
    'process' AS p,
    ? AS v
UNION SELECT
    REPLACE(property_definition.dataproperty, 'database-', '') AS k,
    property.value_string AS v
FROM
    property,
    property_definition
WHERE property.property_definition_keyname = property_definition.keyname
AND property.is_deleted = 0
AND property_definition.dataproperty IN ('database-host', 'database-name', 'database-user', 'database-password', 'database-ssl')
AND entity_id = (
    SELECT entity_id
    FROM property
    WHERE property_definition_keyname = 'customer-database-name'
    AND value_string = ?
    LIMIT 1
);
