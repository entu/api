SELECT
    entity,
    type,
    language,
    datatype,
    value_text,
    value_integer,
    value_decimal,
    value_date,
    created_at,
    created_by,
    deleted_at,
    deleted_by
FROM props
ORDER BY
    entity,
    type,
    language,
    type
LIMIT ? OFFSET ?;
