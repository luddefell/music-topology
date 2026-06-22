package com.soundscapemap.api.controller;

import com.soundscapemap.api.config.AppProperties;
import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.model.RegionTarget;
import com.soundscapemap.api.model.UserSession;
import com.soundscapemap.api.model.VoteInput;
import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.service.JwtService;
import com.soundscapemap.api.service.RateLimiterService;
import com.soundscapemap.api.service.ValidationService;
import com.soundscapemap.api.ws.RegionUpdateHub;
import jakarta.servlet.http.HttpServletRequest;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class VoteController {
  private final JwtService jwt;
  private final SoundscapeRepository repository;
  private final ValidationService validation;
  private final RateLimiterService limiter;
  private final RegionUpdateHub hub;

  public VoteController(JwtService jwt, SoundscapeRepository repository, ValidationService validation, RateLimiterService limiter, RegionUpdateHub hub) {
    this.jwt = jwt;
    this.repository = repository;
    this.validation = validation;
    this.limiter = limiter;
    this.hub = hub;
  }

  @PostMapping("/api/votes")
  public ResponseEntity<?> vote(@RequestBody Map<String, Object> body, @RequestHeader(name = "Authorization", required = false) String auth, HttpServletRequest request) throws Exception {
    RegionTarget region = validation.normalize(body).orElse(null);
    String trackId = string(body, "track_id");
    String genre = string(body, "genre");
    if (region == null || !validation.isTrackId(trackId) || genre == null || genre.isBlank()) {
      return ResponseEntity.badRequest().body(ApiError.of("INVALID_VOTE", "Vote payload is invalid."));
    }
    UserSession session = jwt.fromAuthorization(auth).orElseGet(() -> {
      try {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(("ip:" + request.getRemoteAddr()).getBytes()));
        return new UserSession(repository.upsertAnonymousUser(hash), null, true);
      } catch (Exception error) {
        throw new IllegalStateException(error);
      }
    });
    RateLimiterService.Result allowed = limiter.allow("vote:" + session.userId() + ":" + region.regionId(), 1, 1800);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "VOTE_RATE_LIMITED", "message", "You've voted recently here. Come back soon.", "retry_after", allowed.retryAfter())));

    repository.insertVote(new VoteInput(
        session.userId(),
        region.regionId(),
        region.regionType(),
        region.h3Cell(),
        trackId,
        string(body, "track_name"),
        string(body, "artist"),
        string(body, "album_art"),
        genre,
        string(body, "genre_label"),
        1.0,
        "vote"
    ));
    var snapshot = repository.computeSnapshot(region.regionId(), region.regionType());
    hub.publish(snapshot);
    return ResponseEntity.ok(Map.of("ok", true, "region_snapshot", snapshot));
  }

  private String string(Map<String, Object> body, String key) {
    Object value = body.get(key);
    return value == null ? null : String.valueOf(value);
  }
}
