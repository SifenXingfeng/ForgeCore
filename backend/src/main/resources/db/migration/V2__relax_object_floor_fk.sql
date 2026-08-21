-- floor_id is currently a structural hint for the MVP payload. The composite
-- FK cannot use SET NULL because factory_id is part of the key and NOT NULL;
-- keeping it application-validated also allows a factory cascade delete.
ALTER TABLE factory_object DROP FOREIGN KEY fk_object_floor;
