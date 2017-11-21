SELECT
    id,
    md5,
    s3_key,
    url,
    filesize
FROM file
WHERE url IS NULL
AND changed IS NULL
AND filesize <= 2147483647
ORDER BY filesize;
