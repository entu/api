SELECT
    id,
    md5,
    s3_key,
    url
FROM file
WHERE url IS NULL
AND changed IS NULL
ORDER BY id
LIMIT ? OFFSET ?;
