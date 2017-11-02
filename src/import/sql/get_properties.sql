SELECT
    md5 AS `_md5`,
    entity,
    type,
    language,
    datatype,
    public,
    value_text AS `string`,
    value_integer AS `integer`,
    value_decimal AS `decimal`,
    value_reference AS `reference`,
    value_date AS `date`,
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
