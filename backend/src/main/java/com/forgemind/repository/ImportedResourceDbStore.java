package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ImportedResourceDbStore {
    private static final long MAX_MODEL_BYTES = 80L * 1024L * 1024L;
    private static final long MAX_PROJECT_BYTES = 5L * 1024L * 1024L;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ImportedResourceDbStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> saveForUser(
            String userId,
            String metadataJson,
            MultipartFile projectFile,
            MultipartFile modelFile
    ) {
        if (metadataJson == null || metadataJson.isBlank()) throw new IllegalArgumentException("资源元数据不能为空");
        if (projectFile == null || projectFile.isEmpty()) throw new IllegalArgumentException("资源定义 JSON 不能为空");
        if (modelFile == null || modelFile.isEmpty()) throw new IllegalArgumentException("GLB 模型不能为空");
        if (projectFile.getSize() > MAX_PROJECT_BYTES) throw new IllegalArgumentException("资源定义 JSON 超过 5 MB");
        if (modelFile.getSize() > MAX_MODEL_BYTES) throw new IllegalArgumentException("GLB 文件超过 80 MB");

        JsonNode metadata = parseMetadata(metadataJson);
        String resourceId = textRequired(metadata, "id");
        String modelFileName = safeFileName(modelFile.getOriginalFilename(), "model.glb");
        String contentType = modelFile.getContentType() == null ? "model/gltf-binary" : modelFile.getContentType();
        byte[] projectBytes = readBytes(projectFile, "资源定义 JSON");
        byte[] modelBytes = readBytes(modelFile, "GLB 模型");

        jdbc.update("""
                INSERT INTO imported_resource
                    (owner_user_id, resource_id, metadata_json, project_json, model_blob, model_file_name, model_content_type, model_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    metadata_json = VALUES(metadata_json),
                    project_json = VALUES(project_json),
                    model_blob = VALUES(model_blob),
                    model_file_name = VALUES(model_file_name),
                    model_content_type = VALUES(model_content_type),
                    model_size = VALUES(model_size),
                    updated_at = CURRENT_TIMESTAMP(6)
                """,
                userId, resourceId, metadataJson, new String(projectBytes, StandardCharsets.UTF_8), modelBytes, modelFileName, contentType, modelBytes.length
        );
        return resourceResponse(userId, resourceId, metadata, modelFileName, modelBytes.length);
    }

    public List<Map<String, Object>> listForUser(String userId) {
        return jdbc.query("""
                SELECT resource_id, metadata_json, model_file_name, model_size, updated_at
                FROM imported_resource
                WHERE owner_user_id = ?
                ORDER BY updated_at DESC, resource_id
                """, (rs, rowNum) -> {
            JsonNode metadata = parseMetadata(rs.getString("metadata_json"));
            return resourceResponse(
                    userId,
                    rs.getString("resource_id"),
                    metadata,
                    rs.getString("model_file_name"),
                    rs.getLong("model_size")
            );
        }, userId);
    }

    public Optional<ModelPayload> modelForUser(String userId, String resourceId) {
        List<ModelPayload> models = jdbc.query("""
                SELECT model_blob, model_file_name, model_content_type
                FROM imported_resource
                WHERE owner_user_id = ? AND resource_id = ?
                """, (rs, rowNum) -> new ModelPayload(
                rs.getBytes("model_blob"),
                rs.getString("model_file_name"),
                rs.getString("model_content_type")
        ), userId, resourceId);
        return models.stream().findFirst();
    }

    public boolean belongsToUser(String userId, String resourceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM imported_resource WHERE owner_user_id = ? AND resource_id = ?",
                Integer.class,
                userId,
                resourceId
        );
        return count != null && count > 0;
    }

    private Map<String, Object> resourceResponse(String userId, String resourceId, JsonNode metadata, String modelFileName, long modelSize) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", resourceId);
        response.put("name", metadata.path("name").asText("导入设备"));
        response.put("modelFileName", modelFileName);
        response.put("sourceFileName", metadata.path("sourceFileName").asText("resource.json"));
        response.put("sourceFormat", metadata.path("sourceFormat").asText("unknown"));
        response.put("previewDataUrl", metadata.path("previewDataUrl").asText(""));
        response.put("warnings", jsonStringList(metadata.path("warnings")));
        response.put("objectDef", metadata.path("objectDef"));
        response.put("modelSize", modelSize);
        response.put("modelUrl", "/api/resources/" + resourceId + "/model");
        response.put("updatedAt", metadata.path("importedAt").asText(Instant.now().toString()));
        return response;
    }

    private List<String> jsonStringList(JsonNode node) {
        List<String> values = new ArrayList<>();
        if (node.isArray()) node.forEach(value -> { if (value.isTextual()) values.add(value.asText()); });
        return values;
    }

    private JsonNode parseMetadata(String value) {
        try {
            JsonNode node = mapper.readTree(value);
            if (node == null || !node.isObject()) throw new IllegalArgumentException("资源元数据格式非法");
            return node;
        } catch (IOException e) {
            throw new IllegalArgumentException("资源元数据不是有效 JSON", e);
        }
    }

    private byte[] readBytes(MultipartFile file, String label) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new IllegalArgumentException(label + "读取失败", e);
        }
    }

    private String textRequired(JsonNode node, String field) {
        String value = node.path(field).asText("").trim();
        if (value.isEmpty() || value.length() > 96) throw new IllegalArgumentException(field + "非法");
        return value;
    }

    private String safeFileName(String value, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String name = value.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).trim();
        return name.isEmpty() ? fallback : name.substring(0, Math.min(name.length(), 255));
    }

    public record ModelPayload(byte[] bytes, String fileName, String contentType) {}
}
