package com.forgemind.web;

import com.forgemind.model.User;
import com.forgemind.repository.ImportedResourceDbStore;
import com.forgemind.service.AuthService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/resources")
@CrossOrigin(origins = "*")
public class ImportedResourceController {
    private final ImportedResourceDbStore resources;
    private final AuthService auth;

    public ImportedResourceController(ImportedResourceDbStore resources, AuthService auth) {
        this.resources = resources;
        this.auth = auth;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        User user = auth.currentUser(authorization);
        return resources.listForUser(user.id());
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @RequestPart("metadata") String metadata,
            @RequestPart("project") MultipartFile project,
            @RequestPart("model") MultipartFile model
    ) {
        User user = auth.currentUser(authorization);
        return resources.saveForUser(user.id(), metadata, project, model);
    }

    @GetMapping("/{resourceId}/model")
    public ResponseEntity<ByteArrayResource> model(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String resourceId
    ) {
        User user = auth.currentUser(authorization);
        ImportedResourceDbStore.ModelPayload payload = resources.modelForUser(user.id(), resourceId)
                .orElseThrow(() -> new IllegalArgumentException("设备模型不存在"));
        MediaType mediaType = MediaType.parseMediaType(payload.contentType());
        ContentDisposition disposition = ContentDisposition.inline()
                .filename(payload.fileName(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .contentType(mediaType)
                .contentLength(payload.bytes().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(new ByteArrayResource(payload.bytes()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> onBadRequest(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Map.of("error", error.getMessage() == null ? "资源请求非法" : error.getMessage()));
    }
}
