package com.soundscapemap.api.controller;

import com.soundscapemap.api.repository.SoundscapeRepository;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final SoundscapeRepository repository;

  public HealthController(SoundscapeRepository repository) {
    this.repository = repository;
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("ok", true);
  }

  @GetMapping("/health/db")
  public Map<String, Object> dbHealth() {
    long started = System.currentTimeMillis();
    repository.ping();
    return Map.of("ok", true, "latency_ms", System.currentTimeMillis() - started);
  }

  @GetMapping("/health/redis")
  public Map<String, Object> redisHealth() {
    return Map.of("ok", true, "mode", "in_memory");
  }

  @GetMapping("/health/spotify")
  public Map<String, Object> spotifyHealth() {
    return Map.of("ok", true, "circuit", Map.of("state", "closed"));
  }
}
