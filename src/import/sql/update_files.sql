UPDATE file SET
    md5 = ?,
    filesize = ?,
    changed = NOW(),
    changed_by = ?
WHERE id = ?;
