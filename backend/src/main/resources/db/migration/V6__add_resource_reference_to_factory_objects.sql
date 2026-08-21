ALTER TABLE factory_object
    ADD COLUMN resource_id VARCHAR(96) NULL AFTER object_type,
    ADD KEY idx_factory_object_resource (factory_id, resource_id);
