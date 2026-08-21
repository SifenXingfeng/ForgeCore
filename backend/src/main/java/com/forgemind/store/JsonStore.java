package com.forgemind.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.FactorySave;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/**
 * 旧版 JSON 文件存储，仅保留给历史数据查看或人工迁移使用。
 * 当前运行时由 FactoryDbStore 写入 MySQL；此类不再注册为 Spring Bean，避免
 * 新接口误用本地单文件并造成多套数据源分叉。
 */
public class JsonStore {

    private static final Path DATA_PATH = Paths.get("data", "factory.json");

    private final ObjectMapper mapper = new ObjectMapper();

    public FactorySave load() {
        try {
            if (!Files.exists(DATA_PATH)) {
                return new FactorySave(1, null, List.of(), List.of(), List.of());
            }
            return mapper.readValue(DATA_PATH.toFile(), FactorySave.class);
        } catch (Exception e) {
            throw new RuntimeException("读取存档失败: " + e.getMessage(), e);
        }
    }

    public void save(FactorySave save) {
        try {
            Files.createDirectories(DATA_PATH.getParent());
            mapper.writerWithDefaultPrettyPrinter().writeValue(DATA_PATH.toFile(), save);
        } catch (Exception e) {
            throw new RuntimeException("写入存档失败: " + e.getMessage(), e);
        }
    }
}
