package com.forgemind.web;

import com.forgemind.model.FactorySave;
import com.forgemind.model.User;
import com.forgemind.repository.FactoryDbStore;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 旧版单工厂兼容接口。新项目库使用 /api/factories，保存完整 v5 载荷。
 */
@RestController
@RequestMapping("/api/factory")
@CrossOrigin(origins = "*")
public class FactoryController {

    private final FactoryDbStore store;
    private final AuthService auth;

    public FactoryController(FactoryDbStore store, AuthService auth) {
        this.store = store;
        this.auth = auth;
    }

    @GetMapping
    public FactorySave getFactory(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        User user = auth.currentUser(authorization);
        return store.loadForUser(user.id());
    }

    @PutMapping
    public FactorySave saveFactory(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @RequestBody FactorySave save
    ) {
        User user = auth.currentUser(authorization);
        return store.saveForUser(user.id(), save);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "service", "forgemind-backend");
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage() == null ? "请求非法" : e.getMessage());
    }
}
