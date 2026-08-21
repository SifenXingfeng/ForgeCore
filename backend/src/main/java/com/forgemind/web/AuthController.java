package com.forgemind.web;

import com.forgemind.model.User;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 认证 REST 接口：注册 / 登录 / 当前用户 / 登出。
 * 会话 token 的 SHA-256 摘要持久化在 MySQL，原始 token 只返回给客户端。
 */
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    public record AuthRequest(String username, String password) {}
    public record AuthResponse(String token, String username) {}
    public record MeResponse(String id, String username) {}

    @PostMapping("/register")
    public AuthResponse register(@RequestBody AuthRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = auth.register(req.username(), req.password());
        return new AuthResponse(result.token(), result.username());
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody AuthRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = auth.login(req.username(), req.password());
        return new AuthResponse(result.token(), result.username());
    }

    @GetMapping("/me")
    public MeResponse me(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        User user = this.auth.currentUser(auth);
        return new MeResponse(user.id(), user.username());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        this.auth.logout(auth);
        return Map.of("status", "ok");
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage());
    }

}
