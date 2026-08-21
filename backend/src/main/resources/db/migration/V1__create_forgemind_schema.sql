-- ForgeMind v1 MySQL schema.
-- Static factory design is persisted here; high-frequency ItemLot state stays in the simulation runtime.

CREATE TABLE app_user (
    id CHAR(36) NOT NULL,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_user_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_session (
    token_hash CHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (token_hash),
    KEY idx_auth_session_user (user_id),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE factory (
    id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    schema_version INT NOT NULL DEFAULT 2,
    width INT NULL,
    depth INT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_factory_owner (owner_user_id),
    CONSTRAINT fk_factory_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE factory_member (
    factory_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'owner',
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (factory_id, user_id),
    CONSTRAINT fk_factory_member_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE,
    CONSTRAINT fk_factory_member_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE floor (
    factory_id CHAR(36) NOT NULL,
    id VARCHAR(64) NOT NULL,
    floor_no INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    width INT NULL,
    depth INT NULL,
    PRIMARY KEY (factory_id, id),
    UNIQUE KEY uq_floor_number (factory_id, floor_no),
    CONSTRAINT fk_floor_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE item (
    factory_id CHAR(36) NOT NULL,
    id VARCHAR(96) NOT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(24) NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '#4fc3f7',
    size DECIMAL(12,3) NOT NULL DEFAULT 1,
    note VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (factory_id, id),
    UNIQUE KEY uq_item_name (factory_id, name),
    CONSTRAINT fk_item_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE recipe (
    factory_id CHAR(36) NOT NULL,
    id VARCHAR(96) NOT NULL,
    name VARCHAR(120) NOT NULL,
    duration_sec DECIMAL(12,3) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (factory_id, id),
    UNIQUE KEY uq_recipe_name (factory_id, name),
    CONSTRAINT fk_recipe_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE recipe_port (
    factory_id CHAR(36) NOT NULL,
    recipe_id VARCHAR(96) NOT NULL,
    item_id VARCHAR(96) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    port_order INT NOT NULL,
    qty DECIMAL(12,3) NOT NULL,
    PRIMARY KEY (factory_id, recipe_id, direction, port_order),
    KEY idx_recipe_port_item (factory_id, item_id),
    CONSTRAINT fk_recipe_port_recipe FOREIGN KEY (factory_id, recipe_id) REFERENCES recipe (factory_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_recipe_port_item FOREIGN KEY (factory_id, item_id) REFERENCES item (factory_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE factory_object (
    factory_id CHAR(36) NOT NULL,
    id VARCHAR(96) NOT NULL,
    floor_id VARCHAR(64) NULL,
    object_type VARCHAR(32) NOT NULL,
    pos_x DECIMAL(12,3) NOT NULL,
    pos_z DECIMAL(12,3) NOT NULL,
    rotation SMALLINT NOT NULL,
    recipe_id VARCHAR(96) NULL,
    item_id VARCHAR(96) NULL,
    properties_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (factory_id, id),
    KEY idx_factory_object_type (factory_id, object_type),
    CONSTRAINT fk_object_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE,
    CONSTRAINT fk_object_floor FOREIGN KEY (factory_id, floor_id) REFERENCES floor (factory_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_object_recipe FOREIGN KEY (factory_id, recipe_id) REFERENCES recipe (factory_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_object_item FOREIGN KEY (factory_id, item_id) REFERENCES item (factory_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE factory_connection (
    factory_id CHAR(36) NOT NULL,
    id VARCHAR(96) NOT NULL,
    source_object_id VARCHAR(96) NOT NULL,
    target_object_id VARCHAR(96) NOT NULL,
    source_port VARCHAR(32) NULL,
    target_port VARCHAR(32) NULL,
    direction VARCHAR(16) NULL,
    properties_json JSON NULL,
    PRIMARY KEY (factory_id, id),
    KEY idx_connection_source (factory_id, source_object_id),
    KEY idx_connection_target (factory_id, target_object_id),
    CONSTRAINT fk_connection_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE,
    CONSTRAINT fk_connection_source FOREIGN KEY (factory_id, source_object_id) REFERENCES factory_object (factory_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_connection_target FOREIGN KEY (factory_id, target_object_id) REFERENCES factory_object (factory_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE simulation_snapshot (
    id BIGINT NOT NULL AUTO_INCREMENT,
    factory_id CHAR(36) NOT NULL,
    seed BIGINT NOT NULL,
    time_sec DECIMAL(16,3) NOT NULL,
    snapshot_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_snapshot_factory_time (factory_id, created_at),
    CONSTRAINT fk_snapshot_factory FOREIGN KEY (factory_id) REFERENCES factory (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
