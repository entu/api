SELECT
    NULLIF(LOWER(TRIM(REPLACE(entity_id, '-', '_'))), '') AS entity_id,
    NULLIF(LOWER(TRIM(entity_deleted)), '') AS entity_deleted,
    NULLIF(LOWER(TRIM(REPLACE(property_definition, '-', '_'))), '') AS property_definition,
    NULLIF(LOWER(TRIM(property_language)), '') AS property_language,
    NULLIF(LOWER(TRIM(property_type)), '') AS property_type,
    NULLIF(TRIM(property_value), '') AS property_value,
    NULLIF(LOWER(TRIM(property_created_at)), '') AS property_created_at,
    NULLIF(LOWER(TRIM(property_created_by)), '') AS property_created_by,
    NULLIF(LOWER(TRIM(property_deleted_at)), '') AS property_deleted_at,
    NULLIF(LOWER(TRIM(property_deleted_by)), '') AS property_deleted_by
FROM (
    /* entity id */
    SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_mid' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        id AS property_value,
        created AS property_created_at,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    /* entity definition */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_definition' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        LOWER(REPLACE(entity_definition_keyname, '-', '_')) AS property_value,
        created AS property_created_at,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    /* entity sharing */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_sharing' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        sharing AS property_value,
        created AS property_created_at,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND sharing IS NOT NULL
    /* entity created at */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_created_at' AS property_definition,
        'datetime' AS property_type,
        NULL AS property_language,
        created AS property_value,
        created AS property_created_at,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND created IS NOT NULL
    /* entity created by */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_created_by' AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_value,
        created AS property_created_at,
        IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) IS NOT NULL
    /* entity deleted at */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_deleted_at' AS property_definition,
        'datetime' AS property_type,
        NULL AS property_language,
        IFNULL(deleted, NOW()) AS property_value,
        IFNULL(deleted, NOW()) AS property_created_at,
        IF(CAST(deleted_by AS UNSIGNED) > 0, CAST(deleted_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND is_deleted = 1
    /* entity deleted by */
    UNION SELECT
        id AS entity_id,
        IF(is_deleted = 1, 1, NULL) AS entity_deleted,
        '_deleted_by' AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        IF(CAST(deleted_by AS UNSIGNED) > 0, CAST(deleted_by AS UNSIGNED), NULL) AS property_value,
        deleted AS property_created_at,
        IF(CAST(deleted_by AS UNSIGNED) > 0, CAST(deleted_by AS UNSIGNED), NULL) AS property_created_by,
        NULL AS property_deleted_at,
        NULL AS property_deleted_by
    FROM entity
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND IF(CAST(created_by AS UNSIGNED) > 0, CAST(created_by AS UNSIGNED), NULL) IS NOT NULL
    AND is_deleted = 1
    /* properties */
    UNION SELECT
        p.entity_id,
        IF(e.is_deleted = 1, 1, NULL) AS entity_deleted,
        pd.dataproperty AS property_definition,
        pd.datatype AS property_type,
        CASE IF(pd.multilingual = 1, p.language, NULL)
            WHEN 'estonian' THEN 'et'
            WHEN 'english' THEN 'en'
            ELSE NULL
        END AS property_language,
        CASE pd.datatype
            WHEN 'string' THEN TRIM(p.value_string)
            WHEN 'text' THEN TRIM(p.value_text)
            WHEN 'integer' THEN p.value_integer
            WHEN 'decimal' THEN p.value_decimal
            WHEN 'boolean' THEN p.value_boolean
            WHEN 'date' THEN DATE_FORMAT(p.value_datetime, '%Y-%m-%d')
            WHEN 'datetime' THEN DATE_FORMAT(CONVERT_TZ(p.value_datetime, 'Europe/Tallinn', 'UTC'), '%Y-%m-%d %H:%i:%s')
            WHEN 'reference' THEN p.value_reference
            WHEN 'file' THEN p.value_file
            ELSE NULL
        END AS property_value,
        IF(p.created IS NULL, e.created, p.created) AS property_created_at,
        IF(CAST(IF(p.created_by IS NULL, e.created_by, p.created_by) AS UNSIGNED) > 0, CAST(IF(p.created_by IS NULL, e.created_by, p.created_by) AS UNSIGNED), NULL) AS property_created_by,
        IF(p.is_deleted = 1, IFNULL(p.deleted, NOW()), NULL) AS property_deleted_at,
        IF(p.is_deleted = 1, IF(CAST(p.deleted_by AS UNSIGNED) > 0, CAST(p.deleted_by AS UNSIGNED), NULL), NULL) AS property_deleted_by
    FROM
        property AS p,
        property_definition AS pd,
        entity AS e
    WHERE pd.keyname = p.property_definition_keyname
    AND e.id = p.entity_id
    AND pd.formula = 0
    AND pd.dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND e.entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    /* parents */
    UNION SELECT
        r.related_entity_id AS entity_id,
        IF(e.is_deleted = 1, 1, NULL) AS entity_deleted,
        '_parent' AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        r.entity_id AS property_value,
        IF(r.created IS NULL, e.created, r.created) AS property_created_at,
        IF(CAST(IF(r.created_by IS NULL, e.created_by, r.created_by) AS UNSIGNED) > 0, CAST(IF(r.created_by IS NULL, e.created_by, r.created_by) AS UNSIGNED), NULL) AS property_created_by,
        IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL) AS property_deleted_at,
        IF(r.is_deleted = 1, IF(CAST(r.deleted_by AS UNSIGNED) > 0, CAST(r.deleted_by AS UNSIGNED), NULL), NULL) AS property_deleted_by
    FROM
        relationship AS r,
        entity AS e
    WHERE e.id = r.related_entity_id
    AND r.relationship_definition_keyname = 'child'
    /* rights */
    UNION SELECT
        r.entity_id,
        IF(e.is_deleted = 1, 1, NULL) AS entity_deleted,
        CONCAT('_', r.relationship_definition_keyname) AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        r.related_entity_id AS property_value,
        IF(r.created IS NULL, e.created, r.created) AS property_created_at,
        IF(CAST(IF(r.created_by IS NULL, e.created_by, r.created_by) AS UNSIGNED) > 0, CAST(IF(r.created_by IS NULL, e.created_by, r.created_by) AS UNSIGNED), NULL) AS property_created_by,
        IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL) AS property_deleted_at,
        IF(r.is_deleted = 1, IF(CAST(r.deleted_by AS UNSIGNED) > 0, CAST(r.deleted_by AS UNSIGNED), NULL), NULL) AS property_deleted_by
    FROM
        relationship AS r,
        entity AS e
    WHERE e.id = r.entity_id
    AND r.relationship_definition_keyname IN ('editor', 'expander', 'owner', 'viewer')
) AS x
WHERE NULLIF(TRIM(entity_id), '') IS NOT NULL
AND NULLIF(TRIM(property_definition), '') IS NOT NULL
AND NULLIF(TRIM(property_value), '') IS NOT NULL
ORDER BY
    entity_id,
    property_definition,
    property_language,
    property_type,
    property_value
-- LIMIT 50;
