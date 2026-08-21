-- One overwrite-only recovery slot per account. This table is deliberately
-- separate from `factory`: timed recovery writes must never create or mutate
-- a user-managed factory archive.
CREATE TABLE factory_autosave (
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    schema_version INT NOT NULL,
    save_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (owner_user_id),
    CONSTRAINT fk_factory_autosave_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
