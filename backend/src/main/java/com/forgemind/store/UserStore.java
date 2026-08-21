package com.forgemind.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.User;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 旧版 JSON 用户存储，仅保留给历史数据查看或人工迁移使用。
 * 当前认证由 AuthService + MySQL 完成；此类不再注册为 Spring Bean。
 */
public class UserStore {

    private static final Path DATA_PATH = Paths.get("data", "users.json");

    private final ObjectMapper mapper = new ObjectMapper();

    public synchronized List<User> loadAll() {
        try {
            if (!Files.exists(DATA_PATH)) {
                return new ArrayList<>();
            }
            return new ArrayList<>(mapper.readValue(
                    DATA_PATH.toFile(),
                    mapper.getTypeFactory().constructCollectionType(List.class, User.class)));
        } catch (Exception e) {
            throw new RuntimeException("读取用户数据失败: " + e.getMessage(), e);
        }
    }

    public synchronized Optional<User> findByUsername(String username) {
        return loadAll().stream().filter(u -> u.username().equals(username)).findFirst();
    }

    public synchronized void saveAll(List<User> users) {
        try {
            Files.createDirectories(DATA_PATH.getParent());
            mapper.writerWithDefaultPrettyPrinter().writeValue(DATA_PATH.toFile(), users);
        } catch (Exception e) {
            throw new RuntimeException("写入用户数据失败: " + e.getMessage(), e);
        }
    }
}
