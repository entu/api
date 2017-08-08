SELECT
    entity_id AS entity,
    definition AS def,
    language AS lang,
    type,
    value_text,
    value_integer,
    value_decimal,
    value_date,
    IF(created_at > '2000-01-01', created_at, NULL) AS created_at,
    created_by,
    IF(deleted_at > '2000-01-01', deleted_at, NULL) AS deleted_at,
    deleted_by
FROM props
ORDER BY
    entity_id,
    definition,
    language,
    type;
