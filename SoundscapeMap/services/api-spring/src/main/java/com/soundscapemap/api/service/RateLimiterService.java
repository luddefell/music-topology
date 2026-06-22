package com.soundscapemap.api.service;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class RateLimiterService {
  private final Map<String, Window> windows = new ConcurrentHashMap<>();

  public Result allow(String key, int limit, int windowSeconds) {
    long now = Instant.now().getEpochSecond();
    Window window = windows.compute(key, (ignored, current) -> {
      if (current == null || now >= current.resetAt()) return new Window(1, now + windowSeconds);
      return new Window(current.count() + 1, current.resetAt());
    });
    if (window.count() <= limit) return new Result(true, 0);
    return new Result(false, Math.max(1, window.resetAt() - now));
  }

  public record Result(boolean ok, long retryAfter) {}
  private record Window(int count, long resetAt) {}
}
