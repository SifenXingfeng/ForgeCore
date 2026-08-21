package com.forgemind.model;

import java.util.List;
import java.util.Map;

/**
 * 旧版 v2 单工厂模型，仅供 /api/factory 和历史结构化数据兼容。
 * 当前完整项目载荷由 /api/factories 以 JsonNode 无损保存。
 */
public record FactorySave(
        Integer version,
        String savedAt,
        List<Map<String, Object>> objects,
        List<Map<String, Object>> items,
        List<Map<String, Object>> recipes
) {}
