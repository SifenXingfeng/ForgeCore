package com.forgemind.repository;

import com.forgemind.model.FactorySave;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Repository
public class FactoryDbStore {
    private static final int SAVE_VERSION = 2;
    private static final Set<String> ITEM_CATEGORIES = Set.of("raw", "intermediate", "product");
    private static final Set<String> OBJECT_TYPES = Set.of(
            "source", "conveyor", "machine", "oreMiner", "smelter", "press", "assembler",
            "inspection", "washing", "agv", "drone", "storage", "splitter", "merger", "imported"
    );
    private static final Set<Integer> ROTATIONS = Set.of(0, 90, 180, 270);

    private final JdbcTemplate jdbc;

    public FactoryDbStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public FactorySave loadForUser(String userId) {
        String factoryId = ensureFactory(userId);
        return loadByFactoryId(factoryId);
    }

    /** Read-only adapter used to expose pre-v7 relational archives in the new project picker. */
    public FactorySave loadByFactoryId(String factoryId) {
        List<Map<String, Object>> items = loadItems(factoryId);
        List<Map<String, Object>> recipes = loadRecipes(factoryId);
        List<Map<String, Object>> objects = loadObjects(factoryId);
        String savedAt = jdbc.queryForObject(
                "SELECT updated_at FROM factory WHERE id = ?",
                (rs, rowNum) -> toInstantString(rs.getTimestamp("updated_at")),
                factoryId
        );
        return new FactorySave(SAVE_VERSION, savedAt, objects, items, recipes);
    }

    @Transactional
    public FactorySave saveForUser(String userId, FactorySave save) {
        if (save == null) throw new IllegalArgumentException("存档不能为空");
        validateSave(userId, save);
        String factoryId = ensureFactory(userId);

        jdbc.update("DELETE FROM factory_connection WHERE factory_id = ?", factoryId);
        jdbc.update("DELETE FROM factory_object WHERE factory_id = ?", factoryId);
        jdbc.update("DELETE FROM recipe_port WHERE factory_id = ?", factoryId);
        jdbc.update("DELETE FROM recipe WHERE factory_id = ?", factoryId);
        jdbc.update("DELETE FROM item WHERE factory_id = ?", factoryId);

        for (Map<String, Object> item : list(save.items(), "items")) insertItem(factoryId, item);
        for (Map<String, Object> recipe : list(save.recipes(), "recipes")) insertRecipe(factoryId, recipe);
        for (Map<String, Object> object : list(save.objects(), "objects")) insertObject(factoryId, object);

        jdbc.update("UPDATE factory SET schema_version = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", SAVE_VERSION, factoryId);
        return loadForUser(userId);
    }

    /**
     * Validate the complete payload before deleting the previous snapshot.
     * The browser performs the same checks for UX, but this is the authoritative
     * boundary for direct API callers and keeps nullable cross-table bindings safe.
     */
    private void validateSave(String userId, FactorySave save) {
        if (save.version() == null || save.version() < 1 || save.version() > SAVE_VERSION) {
            throw new IllegalArgumentException("不支持的存档版本");
        }

        List<Map<String, Object>> items = list(save.items(), "items");
        Set<String> itemIds = new HashSet<>();
        Set<String> itemNames = new HashSet<>();
        for (Map<String, Object> item : items) {
            if (item == null) throw new IllegalArgumentException("物品数据非法");
            String id = requiredString(item, "id");
            if (!itemIds.add(id)) throw new IllegalArgumentException("物品 id 重复：" + id);
            String itemName = requiredString(item, "name");
            if (itemName.length() > 120) throw new IllegalArgumentException("物品名称过长");
            if (!itemNames.add(itemName)) throw new IllegalArgumentException("物品名称重复：" + itemName);
            if (!ITEM_CATEGORIES.contains(requiredString(item, "category"))) {
                throw new IllegalArgumentException("物品类别非法");
            }
            BigDecimal size = decimalOr(item, "size", BigDecimal.ONE);
            if (size.signum() <= 0) throw new IllegalArgumentException("物品尺寸必须大于 0");
        }

        List<Map<String, Object>> recipes = list(save.recipes(), "recipes");
        Set<String> recipeIds = new HashSet<>();
        Set<String> recipeNames = new HashSet<>();
        for (Map<String, Object> recipe : recipes) {
            if (recipe == null) throw new IllegalArgumentException("配方数据非法");
            String id = requiredString(recipe, "id");
            if (!recipeIds.add(id)) throw new IllegalArgumentException("配方 id 重复：" + id);
            String recipeName = requiredString(recipe, "name");
            if (recipeName.length() > 120) throw new IllegalArgumentException("配方名称过长");
            if (!recipeNames.add(recipeName)) throw new IllegalArgumentException("配方名称重复：" + recipeName);
            if (decimalRequired(recipe, "durationSec").signum() <= 0) {
                throw new IllegalArgumentException("配方时长必须大于 0");
            }
            validatePorts(recipe.get("inputs"), "inputs", itemIds);
            validatePorts(recipe.get("outputs"), "outputs", itemIds);
        }

        List<Map<String, Object>> objects = list(save.objects(), "objects");
        Set<String> objectIds = new HashSet<>();
        for (Map<String, Object> object : objects) {
            if (object == null) throw new IllegalArgumentException("对象数据非法");
            String id = requiredString(object, "id");
            if (!objectIds.add(id)) throw new IllegalArgumentException("对象 id 重复：" + id);
            if (!OBJECT_TYPES.contains(requiredString(object, "type"))) {
                throw new IllegalArgumentException("对象类型非法");
            }
            String objectType = requiredString(object, "type");
            String resourceId = stringOrNull(object, "resourceId");
            if ("imported".equals(objectType)) {
                if (resourceId == null || !resourceBelongsToUser(userId, resourceId)) {
                    throw new IllegalArgumentException("导入设备资源不存在或不属于当前用户");
                }
            }
            Object rawPos = object.get("pos");
            if (!(rawPos instanceof Map<?, ?> rawMap)) throw new IllegalArgumentException("对象位置非法");
            Map<String, Object> pos = castMap(rawMap);
            decimalRequired(pos, "x");
            decimalRequired(pos, "z");
            int rotation = integerRequired(object, "rotation");
            if (!ROTATIONS.contains(rotation)) throw new IllegalArgumentException("对象旋转非法");
            String recipeId = stringOrNull(object, "recipeId");
            if (recipeId != null && !recipeIds.contains(recipeId)) {
                throw new IllegalArgumentException("对象引用了不存在的配方");
            }
            String itemId = stringOrNull(object, "itemId");
            if (itemId != null && !itemIds.contains(itemId)) {
                throw new IllegalArgumentException("对象引用了不存在的物品");
            }
        }
    }

    private void validatePorts(Object rawPorts, String direction, Set<String> itemIds) {
        if (!(rawPorts instanceof List<?> ports)) throw new IllegalArgumentException(direction + " 不是数组");
        for (Object rawPort : ports) {
            if (!(rawPort instanceof Map<?, ?> rawMap)) throw new IllegalArgumentException("配方端口非法");
            Map<String, Object> port = castMap(rawMap);
            String itemId = requiredString(port, "itemId");
            if (!itemIds.contains(itemId)) throw new IllegalArgumentException("配方引用了不存在的物品");
            if (decimalRequired(port, "qty").signum() <= 0) {
                throw new IllegalArgumentException("配方数量必须大于 0");
            }
        }
    }

    private String ensureFactory(String userId) {
        List<String> ids = jdbc.query(
                "SELECT id FROM factory WHERE owner_user_id = ? ORDER BY created_at LIMIT 1",
                (rs, rowNum) -> rs.getString("id"), userId
        );
        if (!ids.isEmpty()) return ids.get(0);

        String factoryId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO factory (id, owner_user_id, name, schema_version, width, depth) VALUES (?, ?, ?, ?, ?, ?)",
                factoryId, userId, "A-01 工厂", SAVE_VERSION, 48, 48);
        jdbc.update("INSERT INTO factory_member (factory_id, user_id, role) VALUES (?, ?, 'owner')", factoryId, userId);
        jdbc.update("INSERT INTO floor (factory_id, id, floor_no, name, width, depth) VALUES (?, ?, ?, ?, ?, ?)",
                factoryId, "main-floor", 1, "主生产层", 48, 48);
        return factoryId;
    }

    private List<Map<String, Object>> loadItems(String factoryId) {
        return jdbc.query("SELECT id, name, category, color, size, note FROM item WHERE factory_id = ? ORDER BY created_at, id", (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id"));
            item.put("name", rs.getString("name"));
            item.put("category", rs.getString("category"));
            item.put("color", rs.getString("color"));
            item.put("size", rs.getBigDecimal("size"));
            item.put("note", rs.getString("note"));
            return item;
        }, factoryId);
    }

    private List<Map<String, Object>> loadRecipes(String factoryId) {
        Map<String, Map<String, Object>> recipes = new LinkedHashMap<>();
        jdbc.query("SELECT id, name, duration_sec FROM recipe WHERE factory_id = ? ORDER BY created_at, id", rs -> {
            Map<String, Object> recipe = new LinkedHashMap<>();
            recipe.put("id", rs.getString("id"));
            recipe.put("name", rs.getString("name"));
            recipe.put("durationSec", rs.getBigDecimal("duration_sec"));
            recipe.put("inputs", new ArrayList<Map<String, Object>>());
            recipe.put("outputs", new ArrayList<Map<String, Object>>());
            recipes.put(rs.getString("id"), recipe);
        }, factoryId);
        jdbc.query("SELECT recipe_id, item_id, direction, port_order, qty FROM recipe_port WHERE factory_id = ? ORDER BY recipe_id, direction, port_order", rs -> {
            Map<String, Object> recipe = recipes.get(rs.getString("recipe_id"));
            if (recipe == null) return;
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> ports = (List<Map<String, Object>>) recipe.get("inputs".equals(rs.getString("direction")) ? "inputs" : "outputs");
            Map<String, Object> port = new LinkedHashMap<>();
            port.put("itemId", rs.getString("item_id"));
            port.put("qty", rs.getBigDecimal("qty"));
            ports.add(port);
        }, factoryId);
        return new ArrayList<>(recipes.values());
    }

    private List<Map<String, Object>> loadObjects(String factoryId) {
        return jdbc.query("SELECT id, object_type, resource_id, pos_x, pos_z, rotation, recipe_id, item_id FROM factory_object WHERE factory_id = ? ORDER BY created_at, id", (rs, rowNum) -> {
            Map<String, Object> object = new LinkedHashMap<>();
            object.put("id", rs.getString("id"));
            object.put("type", rs.getString("object_type"));
            object.put("resourceId", rs.getString("resource_id"));
            Map<String, Object> pos = new LinkedHashMap<>();
            pos.put("x", rs.getBigDecimal("pos_x"));
            pos.put("z", rs.getBigDecimal("pos_z"));
            object.put("pos", pos);
            object.put("rotation", rs.getInt("rotation"));
            object.put("recipeId", rs.getString("recipe_id"));
            object.put("itemId", rs.getString("item_id"));
            return object;
        }, factoryId);
    }

    private void insertItem(String factoryId, Map<String, Object> item) {
        jdbc.update("INSERT INTO item (factory_id, id, name, category, color, size, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
                factoryId, requiredString(item, "id"), requiredString(item, "name"), requiredString(item, "category"),
                stringOr(item, "color", "#4fc3f7"), decimalOr(item, "size", BigDecimal.ONE), stringOrNull(item, "note"));
    }

    private void insertRecipe(String factoryId, Map<String, Object> recipe) {
        String recipeId = requiredString(recipe, "id");
        jdbc.update("INSERT INTO recipe (factory_id, id, name, duration_sec) VALUES (?, ?, ?, ?)",
                factoryId, recipeId, requiredString(recipe, "name"), decimalRequired(recipe, "durationSec"));
        insertPorts(factoryId, recipeId, recipe.get("inputs"), "inputs");
        insertPorts(factoryId, recipeId, recipe.get("outputs"), "outputs");
    }

    private void insertPorts(String factoryId, String recipeId, Object rawPorts, String direction) {
        if (!(rawPorts instanceof List<?> ports)) throw new IllegalArgumentException(direction + " 不是数组");
        for (int index = 0; index < ports.size(); index++) {
            if (!(ports.get(index) instanceof Map<?, ?> rawPort)) throw new IllegalArgumentException("配方端口非法");
            Map<String, Object> port = castMap(rawPort);
            jdbc.update("INSERT INTO recipe_port (factory_id, recipe_id, item_id, direction, port_order, qty) VALUES (?, ?, ?, ?, ?, ?)",
                    factoryId, recipeId, requiredString(port, "itemId"), direction, index, decimalRequired(port, "qty"));
        }
    }

    private void insertObject(String factoryId, Map<String, Object> object) {
        Object rawPos = object.get("pos");
        if (!(rawPos instanceof Map<?, ?> rawMap)) throw new IllegalArgumentException("对象位置非法");
        Map<String, Object> pos = castMap(rawMap);
        jdbc.update("INSERT INTO factory_object (factory_id, id, floor_id, object_type, resource_id, pos_x, pos_z, rotation, recipe_id, item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                factoryId, requiredString(object, "id"), "main-floor", requiredString(object, "type"),
                stringOrNull(object, "resourceId"), decimalRequired(pos, "x"), decimalRequired(pos, "z"), integerRequired(object, "rotation"),
                stringOrNull(object, "recipeId"), stringOrNull(object, "itemId"));
    }

    private boolean resourceBelongsToUser(String userId, String resourceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM imported_resource WHERE owner_user_id = ? AND resource_id = ?",
                Integer.class,
                userId,
                resourceId
        );
        return count != null && count > 0;
    }

    private List<Map<String, Object>> list(List<Map<String, Object>> value, String field) {
        if (value == null) throw new IllegalArgumentException(field + " 不是数组");
        return value;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Map<?, ?> value) {
        return (Map<String, Object>) value;
    }

    private String requiredString(Map<String, Object> map, String key) {
        String value = stringOrNull(map, key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " 不能为空");
        return value;
    }

    private String stringOr(Map<String, Object> map, String key, String fallback) {
        String value = stringOrNull(map, key);
        return value == null ? fallback : value;
    }

    private String stringOrNull(Map<String, Object> map, String key) {
        Object value = map.get(key);
        return value instanceof String string && !string.isBlank() ? string : null;
    }

    private BigDecimal decimalRequired(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value instanceof Number number) return new BigDecimal(number.toString());
        throw new IllegalArgumentException(key + " 必须是数字");
    }

    private BigDecimal decimalOr(Map<String, Object> map, String key, BigDecimal fallback) {
        return map.get(key) == null ? fallback : decimalRequired(map, key);
    }

    private int integerRequired(Map<String, Object> map, String key) {
        BigDecimal value = decimalRequired(map, key);
        try {
            return value.intValueExact();
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException(key + " 必须是整数", e);
        }
    }

    private String toInstantString(Timestamp timestamp) {
        return timestamp == null ? Instant.now().toString() : timestamp.toInstant().toString();
    }
}
