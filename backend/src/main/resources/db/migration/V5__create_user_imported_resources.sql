CREATE TABLE imported_resource (
    owner_user_id CHAR(36) NOT NULL,
    resource_id VARCHAR(96) NOT NULL,
    metadata_json JSON NOT NULL,
    project_json LONGTEXT NOT NULL,
    model_blob LONGBLOB NOT NULL,
    model_file_name VARCHAR(255) NOT NULL,
    model_content_type VARCHAR(128) NOT NULL DEFAULT 'model/gltf-binary',
    model_size BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (owner_user_id, resource_id),
    KEY idx_imported_resource_owner (owner_user_id, updated_at),
    CONSTRAINT fk_imported_resource_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
