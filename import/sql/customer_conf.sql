SELECT
    (
        SELECT value_string
        FROM property
        WHERE is_deleted = 0
        AND entity_id = relationship.related_entity_id
        AND property_definition_keyname = 'customer-database-host'
    ) AS host,
    (
        SELECT value_string
        FROM property
        WHERE is_deleted = 0
        AND entity_id = relationship.related_entity_id
        AND property_definition_keyname = 'customer-database-name'
    ) AS `database`,
    (
        SELECT value_string
        FROM property
        WHERE is_deleted = 0
        AND entity_id = relationship.related_entity_id
        AND property_definition_keyname = 'customer-database-user'
    ) AS user,
    (
        SELECT value_string
        FROM property
        WHERE is_deleted = 0
        AND entity_id = relationship.related_entity_id
        AND property_definition_keyname = 'customer-database-password'
    ) AS password,
    (
        SELECT value_string
        FROM property
        WHERE is_deleted = 0
        AND entity_id = relationship.related_entity_id
        AND property_definition_keyname = 'customer-database-ssl'
    ) AS `ssl`
FROM
    relationship,
    entity
WHERE entity.id = relationship.related_entity_id
AND relationship.is_deleted = 0
AND relationship.relationship_definition_keyname = 'child'
AND relationship.entity_id = 210658
AND entity.is_deleted = 0
