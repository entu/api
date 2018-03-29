SELECT
    entity.entity_definition_keyname AS definition,
    file.s3_key
FROM
    entity
LEFT JOIN (
    SELECT
        p.entity_id,
        f.id,
        f.md5,
        f.s3_key
    FROM
        property AS p,
        property_definition AS pd,
        file AS f
    WHERE pd.keyname = p.property_definition_keyname
    AND f.id = p.value_file
    AND p.is_deleted = 0
    AND p.value_file > 0
    AND p.entity_id = ?
    AND pd.is_deleted = 0
    AND pd.dataproperty = 'photo'
    ORDER BY f.filename
    LIMIT 1
) AS file ON file.entity_id = entity.id
WHERE entity.id = ?
AND entity.is_deleted = 0
AND (
    entity.id IN (
        SELECT entity_id
        FROM relationship
        WHERE related_entity_id IN (
            SELECT entity.id
            FROM
                entity,
                property,
                property_definition
            WHERE property.entity_id = entity.id
            AND property_definition.keyname = property.property_definition_keyname
            AND property.is_deleted = 0
            AND entity.is_deleted = 0
            AND property_definition.dataproperty = 'entu-user'
            AND property.value_string = ?
        )
        AND relationship_definition_keyname IN ('viewer', 'expander', 'editor', 'owner')
        AND is_deleted = 0
    )
    OR entity.sharing = 'public'
)
LIMIT 1;
