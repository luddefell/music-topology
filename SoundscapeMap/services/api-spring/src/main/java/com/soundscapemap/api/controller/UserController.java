package com.soundscapemap.api.controller;

import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.service.JwtService;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
  private final JwtService jwt;
  private final SoundscapeRepository repository;

  public UserController(JwtService jwt, SoundscapeRepository repository) {
    this.jwt = jwt;
    this.repository = repository;
  }

  @GetMapping("/api/users/me/data")
  public ResponseEntity<?> data(@RequestHeader(name = "Authorization", required = false) String auth) {
    var session = jwt.fromAuthorization(auth).orElse(null);
    if (session == null) return ResponseEntity.status(401).body(ApiError.of("INVALID_TOKEN", "Authentication required."));
    return ResponseEntity.ok(Map.of(
        "user", Map.of("id", session.userId(), "spotify_id", session.spotifyId() == null ? "" : session.spotifyId(), "anonymous", session.anonymous()),
        "export_generated_at", Instant.now().toString(),
        "note", "Vote export query is intentionally scoped to authenticated users in the production repository."
    ));
  }

  @DeleteMapping("/api/users/me")
  public ResponseEntity<?> delete(@RequestHeader(name = "Authorization", required = false) String auth) {
    var session = jwt.fromAuthorization(auth).orElse(null);
    if (session == null) return ResponseEntity.status(401).body(ApiError.of("INVALID_TOKEN", "Authentication required."));
    repository.deleteUserData(session.userId());
    return ResponseEntity.noContent().build();
  }
}
