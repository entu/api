SELECT
    entity.entity_definition_keyname AS type,
    file.s3_key AS s3,
    IFNULL(email.email, entity.id) AS id
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
LEFT JOIN (
    SELECT
        p.entity_id,
        p.value_string  AS email
    FROM
        property AS p,
        property_definition AS pd
    WHERE pd.keyname = p.property_definition_keyname
    AND p.is_deleted = 0
    AND pd.dataproperty IN ('email', 'entu-user')
    AND p.entity_id = ?
    ORDER BY p.id
    LIMIT 1
) AS email ON email.entity_id = entity.id
WHERE entity.id = ?
AND entity.is_deleted = 0
AND (
    entity.id IN (
        SELECT entity_id
        FROM relationship
        WHERE related_entity_id IN (
            SELECT e.id
            FROM
                entity AS e,
                property AS p,
                property_definition AS pd
            WHERE p.entity_id = e.id
            AND pd.keyname = p.property_definition_keyname
            AND p.is_deleted = 0
            AND e.is_deleted = 0
            AND pd.dataproperty = 'entu-user'
            AND p.value_string = ?
        )
        AND relationship_definition_keyname IN ('viewer', 'expander', 'editor', 'owner')
        AND is_deleted = 0
    )
    OR entity.sharing = 'public'
)
LIMIT 1;
