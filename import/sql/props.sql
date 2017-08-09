SELECT
    entity,
    definition,
    language,
    type,
    value_text,
    value_integer,
    value_decimal,
    value_date,
    value_file,
    created_at,
    created_by,
    deleted_at,
    deleted_by
FROM props
ORDER BY
    entity,
    definition,
    language,
    type;
