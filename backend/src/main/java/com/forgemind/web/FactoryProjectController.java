package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.forgemind.model.FactoryProject;
import com.forgemind.model.FactoryProjectSummary;
import com.forgemind.model.User;
import com.forgemind.repository.FactoryProjectDbStore;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** Account-scoped multi-project archive. JSON import/export stays client-side. */
@RestController
@RequestMapping("/api/factories")
@CrossOrigin(origins = "*")
public class FactoryProjectController {
    private final FactoryProjectDbStore store;
    private final AuthService auth;

    public FactoryProjectController(FactoryProjectDbStore store, AuthService auth) {
        this.store = store;
        this.auth = auth;
    }

    public record SaveProjectRequest(String name, JsonNode save) {}

    @GetMapping
    public List<FactoryProjectSummary> list(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization
    ) {
        User user = auth.currentUser(authorization);
        return store.listForUser(user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public FactoryProject create(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @RequestBody SaveProjectRequest request
    ) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("项目请求不能为空");
        return store.createForUser(user.id(), request.name(), request.save());
    }

    @GetMapping("/{projectId}")
    public FactoryProject get(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String projectId
    ) {
        User user = auth.currentUser(authorization);
        return store.loadForUser(user.id(), projectId);
    }

    @PutMapping("/{projectId}")
    public FactoryProject update(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String projectId,
            @RequestBody SaveProjectRequest request
    ) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("项目请求不能为空");
        return store.updateForUser(user.id(), projectId, request.name(), request.save());
    }

    @DeleteMapping("/{projectId}")
    public Map<String, Boolean> delete(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String projectId
    ) {
        User user = auth.currentUser(authorization);
        store.deleteForUser(user.id(), projectId);
        return Map.of("deleted", true);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage() == null ? "请求非法" : e.getMessage());
    }
}
