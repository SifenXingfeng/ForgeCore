package com.forgemind.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.FactoryProject;
import com.forgemind.model.FactoryProjectSummary;
import com.forgemind.model.FactorySave;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Repository
public class FactoryProjectDbStore {
    public static final String AUTOSAVE_PROJECT_ID = "autosave";
    private static final int MAX_SAVE_VERSION = 6;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final FactoryDbStore legacyStore;

    public FactoryProjectDbStore(JdbcTemplate jdbc, ObjectMapper objectMapper, FactoryDbStore legacyStore) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.legacyStore = legacyStore;
    }

    public List<FactoryProjectSummary> listForUser(String userId) {
        List<FactoryProjectSummary> projects = new ArrayList<>();
        projects.addAll(jdbc.query("""
                SELECT name, schema_version, created_at, updated_at, save_json
                FROM factory_autosave
                WHERE owner_user_id = ?
                """, (rs, rowNum) -> autosaveSummaryFromRow(rs), userId));
        projects.addAll(jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.created_at, f.updated_at, f.save_json,
                       (SELECT COUNT(*) FROM factory_object o WHERE o.factory_id = f.id) AS legacy_object_count,
                       (SELECT COUNT(*) FROM item i WHERE i.factory_id = f.id) AS legacy_item_count,
                       (SELECT COUNT(*) FROM recipe r WHERE r.factory_id = f.id) AS legacy_recipe_count,
                       (SELECT COUNT(*) FROM floor fl WHERE fl.factory_id = f.id) AS legacy_floor_count
                FROM factory f
                WHERE f.owner_user_id = ?
                ORDER BY f.updated_at DESC, f.created_at DESC
                """, (rs, rowNum) -> summaryFromRow(rs), userId));
        return projects;
    }

    public FactoryProject loadForUser(String userId, String projectId) {
        if (AUTOSAVE_PROJECT_ID.equals(projectId)) return loadAutosaveForUser(userId);
        List<FactoryProject> matches = jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.created_at, f.updated_at, f.save_json,
                       (SELECT COUNT(*) FROM factory_object o WHERE o.factory_id = f.id) AS legacy_object_count,
                       (SELECT COUNT(*) FROM item i WHERE i.factory_id = f.id) AS legacy_item_count,
                       (SELECT COUNT(*) FROM recipe r WHERE r.factory_id = f.id) AS legacy_recipe_count,
                       (SELECT COUNT(*) FROM floor fl WHERE fl.factory_id = f.id) AS legacy_floor_count
                FROM factory f
                WHERE f.id = ? AND f.owner_user_id = ?
                """, (rs, rowNum) -> {
            FactoryProjectSummary summary = summaryFromRow(rs);
            String rawSave = rs.getString("save_json");
            JsonNode save = rawSave == null
                    ? legacySave(projectId, summary.name())
                    : parseJson(rawSave);
            return new FactoryProject(summary, save);
        }, projectId, userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
        return matches.get(0);
    }

    @Transactional
    public FactoryProject createForUser(String userId, String name, JsonNode save) {
        JsonNode validated = validateSave(save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        String projectId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO factory (id, owner_user_id, name, schema_version, width, depth, save_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                projectId, userId, normalizedName, validated.path("version").asInt(), 48, 48, toJson(validated));
        jdbc.update("INSERT INTO factory_member (factory_id, user_id, role) VALUES (?, ?, 'owner')", projectId, userId);
        return loadForUser(userId, projectId);
    }

    @Transactional
    public FactoryProject updateForUser(String userId, String projectId, String name, JsonNode save) {
        if (AUTOSAVE_PROJECT_ID.equals(projectId)) return updateAutosaveForUser(userId, name, save);
        JsonNode validated = validateSave(save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        int changed = jdbc.update("""
                UPDATE factory
                SET name = ?, schema_version = ?, save_json = ?, updated_at = CURRENT_TIMESTAMP(6)
                WHERE id = ? AND owner_user_id = ?
                """, normalizedName, validated.path("version").asInt(), toJson(validated), projectId, userId);
        if (changed == 0) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
        return loadForUser(userId, projectId);
    }

    @Transactional
    public FactoryProject updateAutosaveForUser(String userId, String name, JsonNode save) {
        JsonNode validated = validateSave(save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        jdbc.update("""
                INSERT INTO factory_autosave (owner_user_id, name, schema_version, save_json)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    schema_version = VALUES(schema_version),
                    save_json = VALUES(save_json),
                    updated_at = CURRENT_TIMESTAMP(6)
                """, userId, normalizedName, validated.path("version").asInt(), toJson(validated));
        return loadAutosaveForUser(userId);
    }

    @Transactional
    public void deleteForUser(String userId, String projectId) {
        int changed = AUTOSAVE_PROJECT_ID.equals(projectId)
                ? jdbc.update("DELETE FROM factory_autosave WHERE owner_user_id = ?", userId)
                : jdbc.update("DELETE FROM factory WHERE id = ? AND owner_user_id = ?", projectId, userId);
        if (changed == 0) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
    }

    private FactoryProject loadAutosaveForUser(String userId) {
        List<FactoryProject> matches = jdbc.query("""
                SELECT name, schema_version, created_at, updated_at, save_json
                FROM factory_autosave
                WHERE owner_user_id = ?
                """, (rs, rowNum) -> new FactoryProject(autosaveSummaryFromRow(rs), parseJson(rs.getString("save_json"))), userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("自动恢复存档不存在");
        return matches.get(0);
    }

    private FactoryProjectSummary summaryFromRow(ResultSet rs) throws SQLException {
        String rawSave = rs.getString("save_json");
        JsonNode save = rawSave == null ? null : parseJson(rawSave);
        int version = save == null ? rs.getInt("schema_version") : save.path("version").asInt(rs.getInt("schema_version"));
        int floorCount = save == null ? rs.getInt("legacy_floor_count") : save.path("floorCount").asInt(1);
        int objectCount = save == null ? rs.getInt("legacy_object_count") : arraySize(save, "objects");
        int itemCount = save == null ? rs.getInt("legacy_item_count") : arraySize(save, "items");
        int recipeCount = save == null ? rs.getInt("legacy_recipe_count") : arraySize(save, "recipes");
        return new FactoryProjectSummary(
                rs.getString("id"),
                rs.getString("name"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                version,
                Math.max(1, floorCount),
                objectCount,
                itemCount,
                recipeCount,
                false
        );
    }

    private FactoryProjectSummary autosaveSummaryFromRow(ResultSet rs) throws SQLException {
        JsonNode save = parseJson(rs.getString("save_json"));
        return new FactoryProjectSummary(
                AUTOSAVE_PROJECT_ID,
                rs.getString("name"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                save.path("version").asInt(rs.getInt("schema_version")),
                Math.max(1, save.path("floorCount").asInt(1)),
                arraySize(save, "objects"),
                arraySize(save, "items"),
                arraySize(save, "recipes"),
                true
        );
    }

    private JsonNode legacySave(String projectId, String projectName) {
        FactorySave legacy = legacyStore.loadByFactoryId(projectId);
        JsonNode node = objectMapper.valueToTree(legacy);
        if (node.isObject()) ((com.fasterxml.jackson.databind.node.ObjectNode) node).put("name", projectName);
        return node;
    }

    private JsonNode validateSave(JsonNode save) {
        if (save == null || !save.isObject()) throw new IllegalArgumentException("存档不能为空");
        int version = save.path("version").asInt(-1);
        if (version < 1 || version > MAX_SAVE_VERSION) throw new IllegalArgumentException("不支持的存档版本");
        requireArray(save, "objects");
        requireArray(save, "items");
        requireArray(save, "recipes");
        if (version >= 5) {
            requireArray(save, "floorNames");
            requireArray(save, "machineDefinitions");
        }
        return save.deepCopy();
    }

    private void requireArray(JsonNode save, String field) {
        if (!save.path(field).isArray()) throw new IllegalArgumentException(field + " 不是数组");
    }

    private int arraySize(JsonNode save, String field) {
        JsonNode node = save.path(field);
        return node.isArray() ? node.size() : 0;
    }

    private String normalizeName(String name, String fallback) {
        String value = name == null || name.isBlank() ? fallback : name;
        value = value == null ? "未命名工厂" : value.trim();
        if (value.isBlank()) value = "未命名工厂";
        return value.substring(0, Math.min(120, value.length()));
    }

    private JsonNode parseJson(String raw) {
        try {
            return objectMapper.readTree(raw);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("数据库中的工厂存档 JSON 已损坏", e);
        }
    }

    private String toJson(JsonNode save) {
        try {
            return objectMapper.writeValueAsString(save);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("存档无法序列化", e);
        }
    }

    private String instant(Timestamp timestamp) {
        return timestamp == null ? Instant.now().toString() : timestamp.toInstant().toString();
    }
}
