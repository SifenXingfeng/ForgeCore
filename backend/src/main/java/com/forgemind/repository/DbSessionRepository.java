package com.forgemind.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.HexFormat;
import java.util.Optional;

@Repository
public class DbSessionRepository {
    private final JdbcTemplate jdbc;

    public DbSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void save(String rawToken, String userId, Instant expiresAt) {
        jdbc.update(
                "INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                hash(rawToken), userId, Timestamp.from(expiresAt)
        );
    }

    public Optional<String> findUserId(String rawToken) {
        jdbc.update("DELETE FROM auth_session WHERE expires_at <= CURRENT_TIMESTAMP(6)");
        return jdbc.query(
                "SELECT user_id FROM auth_session WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP(6)",
                (rs, rowNum) -> rs.getString("user_id"),
                hash(rawToken)
        ).stream().findFirst();
    }

    public void delete(String rawToken) {
        jdbc.update("DELETE FROM auth_session WHERE token_hash = ?", hash(rawToken));
    }

    private String hash(String rawToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
