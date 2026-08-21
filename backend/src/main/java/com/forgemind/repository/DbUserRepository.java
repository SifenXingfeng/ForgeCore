package com.forgemind.repository;

import com.forgemind.model.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.Optional;

@Repository
public class DbUserRepository {
    private final JdbcTemplate jdbc;

    public DbUserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<User> findByUsername(String username) {
        return jdbc.query(
                "SELECT id, username, password_hash, created_at FROM app_user WHERE username = ?",
                (rs, rowNum) -> toUser(rs.getString("id"), rs.getString("username"), rs.getString("password_hash"), rs.getTimestamp("created_at")),
                username
        ).stream().findFirst();
    }

    public Optional<User> findById(String id) {
        return jdbc.query(
                "SELECT id, username, password_hash, created_at FROM app_user WHERE id = ?",
                (rs, rowNum) -> toUser(rs.getString("id"), rs.getString("username"), rs.getString("password_hash"), rs.getTimestamp("created_at")),
                id
        ).stream().findFirst();
    }

    public void insert(User user) {
        jdbc.update(
                "INSERT INTO app_user (id, username, password_hash) VALUES (?, ?, ?)",
                user.id(), user.username(), user.passwordHash()
        );
    }

    private User toUser(String id, String username, String passwordHash, Timestamp createdAt) {
        return new User(id, username, passwordHash, createdAt.toInstant().toString());
    }
}
