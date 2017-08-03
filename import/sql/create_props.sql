/* Fix invalid dates */
UPDATE entity SET created = NULL WHERE CAST(created AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE entity SET changed = NULL WHERE CAST(changed AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE entity SET deleted = NULL WHERE CAST(deleted AS CHAR(20)) = '0000-00-00 00:00:00';

UPDATE property SET created = NULL WHERE CAST(created AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE property SET changed = NULL WHERE CAST(changed AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE property SET deleted = NULL WHERE CAST(deleted AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE property SET value_datetime = NULL WHERE CAST(value_datetime AS CHAR(20)) = '0000-00-00 00:00:00';

UPDATE relationship SET created = NULL WHERE CAST(created AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE relationship SET changed = NULL WHERE CAST(changed AS CHAR(20)) = '0000-00-00 00:00:00';
UPDATE relationship SET deleted = NULL WHERE CAST(deleted AS CHAR(20)) = '0000-00-00 00:00:00';

/* create props table */
DROP TABLE IF EXISTS props;
CREATE TABLE `props` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `entity_id` int(11) unsigned DEFAULT NULL,
  `definition` varchar(32) DEFAULT NULL,
  `language` varchar(2) DEFAULT NULL,
  `type` varchar(16) DEFAULT NULL,
  `value_string` varchar(512) DEFAULT NULL,
  `value_integer` int(11) DEFAULT NULL,
  `value_decimal` decimal(15,4) DEFAULT NULL,
  `value_date` date DEFAULT NULL,
  `value_datetime` datetime DEFAULT NULL,
  `value_text` text,
  `created_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `entity_id` (`entity_id`),
  KEY `definition` (`definition`),
  KEY `language` (`language`),
  KEY `type` (`type`),
  KEY `value_string` (`value_string`),
  KEY `value_integer` (`value_integer`),
  KEY `value_decimal` (`value_decimal`),
  KEY `value_date` (`value_date`),
  KEY `value_datetime` (`value_datetime`),
  KEY `created_at` (`created_at`),
  KEY `deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


/* entity id */
INSERT INTO props (entity_id, definition, type, value_integer, created_at, created_by)
SELECT
    id,
    '_mid',
    'integer',
    id,
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property');


/* entity definition */
INSERT INTO props (entity_id, definition, type, value_string, created_at, created_by)
SELECT
    id,
    '_definition',
    'string',
    TRIM(LOWER(REPLACE(entity_definition_keyname, '-', '_'))),
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property');


/* entity created at */
INSERT INTO props (entity_id, definition, type, value_datetime, created_at, created_by)
SELECT
    id,
    '_created_at',
    'datetime',
    created,
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
AND created IS NOT NULL;


/* entity created by */
INSERT INTO props (entity_id, definition, type, value_integer, created_at, created_by)
SELECT
    id,
    '_created_by',
    'reference',
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL),
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
AND IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL) IS NOT NULL;


/* entity deleted at */
INSERT INTO props (entity_id, definition, type, value_datetime, created_at, created_by)
SELECT
    id,
    '_deleted_at',
    'datetime',
    IFNULL(deleted, NOW()),
    IFNULL(deleted, NOW()),
    IF(TRIM(deleted_by) REGEXP '^-?[0-9]+$', TRIM(deleted_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
AND is_deleted = 1;


/* entity deleted by */
INSERT INTO props (entity_id, definition, type, value_integer, created_at, created_by)
SELECT
    id,
    '_deleted_by',
    'reference',
    IF(TRIM(deleted_by) REGEXP '^-?[0-9]+$', TRIM(deleted_by), NULL),
    deleted,
    IF(TRIM(deleted_by) REGEXP '^-?[0-9]+$', TRIM(deleted_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
AND IF(TRIM(deleted_by) REGEXP '^-?[0-9]+$', TRIM(deleted_by), NULL) IS NOT NULL
AND is_deleted = 1;


/* parents */
INSERT INTO props (entity_id, definition, type, value_integer, created_at, created_by, deleted_at, deleted_by)
SELECT
    r.related_entity_id,
    '_parent',
    'reference',
    r.entity_id,
    IF(r.created IS NULL, e.created, r.created),
    IF(TRIM(r.created_by) REGEXP '^-?[0-9]+$', TRIM(r.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL),
    IF(TRIM(r.deleted_by) REGEXP '^-?[0-9]+$', TRIM(r.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL))
FROM
    relationship AS r,
    entity AS e
WHERE e.id = r.related_entity_id
AND r.relationship_definition_keyname = 'child';


/* rights */
INSERT INTO props (entity_id, definition, type, value_integer, created_at, created_by, deleted_at, deleted_by)
SELECT
    r.entity_id,
    CONCAT('_', r.relationship_definition_keyname),
    'reference',
    r.related_entity_id,
    IF(r.created IS NULL, e.created, r.created),
    IF(TRIM(r.created_by) REGEXP '^-?[0-9]+$', TRIM(r.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL),
    IF(TRIM(r.deleted_by) REGEXP '^-?[0-9]+$', TRIM(r.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL))
FROM
    relationship AS r,
    entity AS e
WHERE e.id = r.entity_id
AND r.relationship_definition_keyname IN ('editor', 'expander', 'owner', 'viewer');


/* entity sharing */
INSERT INTO props (entity_id, definition, type, value_string, created_at, created_by)
SELECT
    id,
    '_sharing',
    'string',
    TRIM(LOWER(sharing)),
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property')
AND sharing IS NOT NULL;


/* properties */
INSERT INTO props (entity_id, definition, type, language, value_string, value_text, value_integer, value_decimal, value_date, value_datetime, created_at, created_by, deleted_at, deleted_by)
SELECT
    p.entity_id,
    pd.dataproperty,
    pd.datatype,
    CASE IF(pd.multilingual = 1, TRIM(p.language), NULL)
        WHEN 'estonian' THEN 'et'
        WHEN 'english' THEN 'en'
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'string' THEN TRIM(p.value_string)
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'text' THEN TRIM(p.value_text)
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'integer' THEN p.value_integer
        WHEN 'boolean' THEN p.value_boolean
        WHEN 'reference' THEN p.value_reference
        WHEN 'file' THEN p.value_file
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'decimal' THEN p.value_decimal
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'date' THEN DATE_FORMAT(p.value_datetime, '%Y-%m-%d')
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'datetime' THEN DATE_FORMAT(CONVERT_TZ(p.value_datetime, 'Europe/Tallinn', 'UTC'), '%Y-%m-%d %H:%i:%s')
        ELSE NULL
    END,
    IF(p.created IS NULL, e.created, p.created),
    IF(TRIM(p.created_by) REGEXP '^-?[0-9]+$', TRIM(p.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(p.is_deleted = 1, IFNULL(p.deleted, NOW()), NULL),
    IF(TRIM(p.deleted_by) REGEXP '^-?[0-9]+$', TRIM(p.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL))
FROM
    property AS p,
    property_definition AS pd,
    entity AS e
WHERE pd.keyname = p.property_definition_keyname
AND e.id = p.entity_id
AND pd.formula = 0
AND pd.dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
AND e.entity_definition_keyname NOT IN ('conf-actions-add', 'conf-datatype', 'conf-entity', 'conf-menu-item', 'conf-property');

OPTIMIZE TABLE props;
