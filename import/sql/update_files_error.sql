UPDATE file SET
    changed = NOW(),
    changed_by = ?
WHERE id = ?;
