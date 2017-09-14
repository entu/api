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
  `entity` int(11) unsigned DEFAULT NULL,
  `type` varchar(32) DEFAULT NULL,
  `language` varchar(2) DEFAULT NULL,
  `datatype` varchar(16) DEFAULT NULL,
  `public` int(1) DEFAULT NULL,
  `value_text` text DEFAULT NULL,
  `value_integer` int(11) DEFAULT NULL,
  `value_decimal` decimal(15,4) DEFAULT NULL,
  `value_date` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `entity` (`entity`),
  KEY `type` (`type`),
  KEY `language` (`language`),
  KEY `datatype` (`datatype`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


/* entity id */
INSERT INTO props (entity, type, datatype, value_integer, created_at, created_by)
SELECT
    id,
    '_mid',
    'integer',
    id,
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT LIKE 'conf-%';


/* entity type */
INSERT INTO props (entity, type, datatype, value_text, created_at, created_by)
SELECT
    id,
    '_type',
    'string',
    TRIM(LOWER(REPLACE(entity_definition_keyname, '-', '_'))),
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT LIKE 'conf-%';


/* entity created at/by */
INSERT INTO props (entity, type, datatype, value_integer, created_at, created_by)
SELECT
    id,
    '_created',
    'boolean',
    1,
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT LIKE 'conf-%'
AND (created IS NOT NULL OR IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL) IS NOT NULL);


/* entity deleted at/by */
INSERT INTO props (entity, type, datatype, value_integer, created_at, created_by)
SELECT
    id,
    '_deleted',
    'boolean',
    1,
    deleted,
    IF(TRIM(deleted_by) REGEXP '^-?[0-9]+$', TRIM(deleted_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT LIKE 'conf-%'
AND is_deleted = 1;


/* parents */
INSERT INTO props (entity, type, datatype, value_integer, created_at, created_by, deleted_at, deleted_by)
SELECT
    r.related_entity_id,
    '_parent',
    'reference',
    r.entity_id,
    IFNULL(r.created, e.created),
    IF(TRIM(r.created_by) REGEXP '^-?[0-9]+$', TRIM(r.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL),
    IF(TRIM(r.deleted_by) REGEXP '^-?[0-9]+$', TRIM(r.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL))
FROM
    relationship AS r,
    entity AS e
WHERE e.id = r.related_entity_id
AND r.relationship_definition_keyname = 'child';


/* rights */
INSERT INTO props (entity, type, datatype, value_integer, created_at, created_by, deleted_at, deleted_by)
SELECT
    r.entity_id,
    CONCAT('_', REPLACE(r.relationship_definition_keyname, '-', '_')),
    'reference',
    r.related_entity_id,
    IFNULL(r.created, e.created),
    IF(TRIM(r.created_by) REGEXP '^-?[0-9]+$', TRIM(r.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(r.is_deleted = 1, IFNULL(r.deleted, NOW()), NULL),
    IF(TRIM(r.deleted_by) REGEXP '^-?[0-9]+$', TRIM(r.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL))
FROM
    relationship AS r,
    entity AS e
WHERE e.id = r.entity_id
AND r.relationship_definition_keyname IN ('editor', 'expander', 'owner', 'viewer');


/* entity sharing */
INSERT INTO props (entity, type, datatype, value_text, created_at, created_by)
SELECT
    id,
    '_sharing',
    'string',
    TRIM(LOWER(sharing)),
    created,
    IF(TRIM(created_by) REGEXP '^-?[0-9]+$', TRIM(created_by), NULL)
FROM entity
WHERE entity_definition_keyname NOT LIKE 'conf-%'
AND sharing IS NOT NULL;


/* properties */
INSERT INTO props (entity, type, datatype, language, public, value_text, value_integer, value_decimal, value_date, created_at, created_by, deleted_at, deleted_by)
SELECT
    p.entity_id,
    REPLACE(pd.dataproperty, '-', '_'),
    pd.datatype,
    CASE IF(pd.multilingual = 1, TRIM(p.language), NULL)
        WHEN 'estonian' THEN 'et'
        WHEN 'english' THEN 'en'
        ELSE NULL
    END,
    (SELECT 1 FROM property_definition WHERE public = 1 AND is_deleted = 0 AND keyname = pd.keyname LIMIT 1),
    CASE pd.datatype
        WHEN 'string' THEN TRIM(p.value_string)
        WHEN 'text' THEN TRIM(p.value_text)
        WHEN 'file' THEN (
            SELECT TRIM(CONCAT(
                'A:',
                IFNULL(TRIM(filename), ''),
                '\nB:',
                IFNULL(TRIM(md5), ''),
                '\nC:',
                IFNULL(TRIM(s3_key), ''),
                '\nD:',
                IFNULL(TRIM(url), ''),
                '\nE:',
                IFNULL(filesize, '')
            )) FROM file WHERE id = p.value_file LIMIT 1
        )
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'integer' THEN p.value_integer
        WHEN 'boolean' THEN p.value_boolean
        WHEN 'reference' THEN p.value_reference
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'decimal' THEN p.value_decimal
        ELSE NULL
    END,
    CASE pd.datatype
        WHEN 'date' THEN DATE_FORMAT(p.value_datetime, '%Y-%m-%d')
        WHEN 'datetime' THEN DATE_FORMAT(CONVERT_TZ(p.value_datetime, 'Europe/Tallinn', 'UTC'), '%Y-%m-%d %H:%i:%s')
        ELSE NULL
    END,
    IFNULL(IF(p.created >= '2000-01-01', p.created, NULL), IF(e.created >= '2000-01-01', e.created, NULL)),
    IF(TRIM(p.created_by) REGEXP '^-?[0-9]+$', TRIM(p.created_by), IF(TRIM(e.created_by) REGEXP '^-?[0-9]+$', TRIM(e.created_by), NULL)),
    IF(p.is_deleted = 1, IF(p.deleted >= '2000-01-01', p.deleted, NOW()), NULL),
    IF(p.is_deleted = 1, IF(TRIM(p.deleted_by) REGEXP '^-?[0-9]+$', TRIM(p.deleted_by), IF(TRIM(e.deleted_by) REGEXP '^-?[0-9]+$', TRIM(e.deleted_by), NULL)), NULL)
FROM
    property AS p,
    property_definition AS pd,
    entity AS e
WHERE pd.keyname = p.property_definition_keyname
AND e.id = p.entity_id
AND pd.formula = 0
AND pd.dataproperty NOT IN ('entu-changed-at', 'entu-changed-by', 'entu-created-at', 'entu-created-by')
AND pd.keyname NOT LIKE 'conf-%'
AND e.entity_definition_keyname NOT LIKE 'conf-%';

OPTIMIZE TABLE props;
