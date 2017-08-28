SELECT
    id,
    md5,
    s3_key,
    url,
    filesize
FROM file
WHERE url IS NULL
AND changed IS NULL
AND s3_key IS NOT NULL
ORDER BY id;
