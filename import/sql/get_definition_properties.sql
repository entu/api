SELECT
    NULLIF(LOWER(TRIM(REPLACE(entity_id, '-', '_'))), '') AS entity,
    NULLIF(LOWER(TRIM(REPLACE(property_definition, '-', '_'))), '') AS definition,
    NULLIF(LOWER(TRIM(property_language)), '') AS language,
    NULLIF(LOWER(TRIM(property_type)), '') AS type,
    NULLIF(TRIM(value_text), '') AS value_text,
    NULLIF(TRIM(value_integer), '') AS value_integer
FROM (

    /* entity keynames */
    SELECT
        keyname AS entity_id,
        'key' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        LOWER(REPLACE(keyname, '-', '_')) AS value_text,
        NULL AS value_integer
    FROM entity_definition
    WHERE keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')

    /* entity definition */
    UNION SELECT
        keyname AS entity_id,
        '_type' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        'entity' AS value_text,
        NULL AS value_integer
    FROM entity_definition
    WHERE keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')

    /* entity open-after-add properties */
    UNION SELECT
        keyname AS entity_id,
        'open-after-add' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM entity_definition
    WHERE keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND open_after_add = 1

    /* entity add-action properties */
    UNION SELECT
        keyname AS entity_id,
        'add-action' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        actions_add AS value_text,
        NULL AS value_integer
    FROM entity_definition
    WHERE keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND actions_add IS NOT NULL

    /* entity translation (label, displayname, ...) fields */
    UNION SELECT
        entity_definition_keyname AS entity_id,
        TRIM(field) AS property_definition,
        'string' AS property_type,
        CASE language
            WHEN 'estonian' THEN 'et'
            WHEN 'english' THEN 'en'
            ELSE NULL
        END AS property_language,
        TRIM(value) AS value_text,
        NULL AS value_integer
    FROM translation
    WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND field NOT IN ('public')
    AND entity_definition_keyname IS NOT NULL

    /* entity allowed-child, default-parent, optional-parent */
    UNION SELECT
        entity_definition_keyname,
        relationship_definition_keyname AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        IFNULL(related_entity_id, LOWER(REPLACE(related_entity_definition_keyname, '-', '_'))) AS value_integer
    FROM
        relationship
    WHERE entity_definition_keyname IS NOT NULL
    AND relationship_definition_keyname IN ('allowed-child', 'default-parent', 'optional-parent')

    /* property keynames */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'key' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        LOWER(REPLACE(keyname, '-', '_')) AS value_text,
        NULL AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)

    /* property definition */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        '_type' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        'property' AS value_text,
        NULL AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)

    /* property parent entity */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        '_parent' AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        LOWER(REPLACE(entity_definition_keyname, '-', '_')) AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)

    /* property datatype */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'type' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        LOWER(datatype) AS value_text,
        NULL AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)

    /* property default value */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'default' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        defaultvalue AS value_text,
        NULL AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(formula < 1, 1) IS NULL
    AND defaultvalue IS NOT NULL

    /* property is formula */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'formula' AS property_definition,
        'string' AS property_type,
        NULL AS property_language,
        defaultvalue AS value_text,
        NULL AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(formula < 1, 1) IS NOT NULL

    /* property is hidden */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'hidden' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND visible = 0

    /* property ordinal */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'ordinal' AS property_definition,
        'integer' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        ordinal AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND ordinal IS NOT NULL

    /* property is multilingual */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'multilingual' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(multilingual < 1, 1) IS NOT NULL

    /* property is list */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'list' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(multiplicity < 1, 1) IS NULL

    /* property is readonly */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'readonly' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(readonly < 1, 1) IS NOT NULL
    AND NULLIF(formula < 1, 1) IS NULL

    /* property is public */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'public' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(public < 1, 1) IS NOT NULL

    /* property is mandatory */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'mandatory' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(mandatory < 1, 1) IS NOT NULL

    /* property is searchable */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'search' AS property_definition,
        'boolean' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        1 AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND NULLIF(search < 1, 1) IS NOT NULL

    /* property has classifier */
    UNION SELECT
        CONCAT(entity_definition_keyname, '_', dataproperty) AS entity_id,
        'classifier' AS property_definition,
        'reference' AS property_type,
        NULL AS property_language,
        NULL AS value_text,
        NULLIF(LOWER(TRIM(REPLACE(classifying_entity_definition_keyname, '-', '_'))), '') AS value_integer
    FROM property_definition
    WHERE dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND classifying_entity_definition_keyname IS NOT NULL

    /* property translation (label, ...) fields */
    UNION SELECT
        CONCAT(pd.entity_definition_keyname, '_', pd.dataproperty) AS entity_id,
        TRIM(t.field) AS property_definition,
        'string' AS property_type,
        CASE t.language
            WHEN 'estonian' THEN 'et'
            WHEN 'english' THEN 'en'
            ELSE NULL
        END AS property_language,
        TRIM(t.value) AS value_text,
        NULL AS value_integer
    FROM
        translation AS t,
        property_definition AS pd
    WHERE pd.keyname = t.property_definition_keyname
    AND t.property_definition_keyname NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
    AND pd.entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
    AND pd.entity_definition_keyname IN (SELECT keyname FROM entity_definition)
    AND t.property_definition_keyname IS NOT NULL
) AS x
WHERE NULLIF(TRIM(entity_id), '') IS NOT NULL
ORDER BY
    entity_id,
    property_definition,
    property_language,
    property_type;
