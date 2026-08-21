package com.forgemind.model;

/**
 * 注册用户模型。密码只存 BCrypt 哈希，绝不存明文。
 */
public record User(String id, String username, String passwordHash, String createdAt) {}
