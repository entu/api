SELECT
    ID AS id,
    DB AS db
FROM information_schema.PROCESSLIST
WHERE TIME > 180
AND COMMAND != 'Sleep';
