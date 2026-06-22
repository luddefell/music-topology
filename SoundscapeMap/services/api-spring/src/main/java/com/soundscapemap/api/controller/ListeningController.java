package com.soundscapemap.api.controller;

import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.model.RegionTarget;
import com.soundscapemap.api.service.JwtService;
import com.soundscapemap.api.service.SpotifyService;
import com.soundscapemap.api.service.ValidationService;
import com.soundscapemap.api.worker.SpotifyPoller;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ListeningController {
  private final JwtService jwt;
  private final SpotifyService spotify;
  private final ValidationService validation;
  private final SpotifyPoller poller;

  public ListeningController(JwtService jwt, SpotifyService spotify, ValidationService validation, SpotifyPoller poller) {
    this.jwt = jwt;
    this.spotify = spotify;
    this.validation = validation;
    this.poller = poller;
  }

  @PostMapping("/api/listening/start")
  public ResponseEntity<?> start(@RequestBody Map<String, Object> body, @RequestHeader(name = "Authorization", required = false) String auth) {
    var session = jwt.fromAuthorization(auth).orElse(null);
    if (session == null || session.anonymous()) {
      return ResponseEntity.status(401).body(ApiError.of("SPOTIFY_REQUIRED", "Connect Spotify before enabling auto-vote."));
    }
    if (spotify.validTokenForUser(session.userId()) == null) {
      return ResponseEntity.status(401).body(ApiError.of("SPOTIFY_TOKEN_EXPIRED", "Spotify session expired. Connect Spotify again."));
    }
    RegionTarget region = validation.normalize(body).orElse(null);
    if (region == null) {
      return ResponseEntity.badRequest().body(ApiError.of("INVALID_REGION", "Select a building or place before enabling auto-vote."));
    }
    poller.add(session.userId(), region.regionId(), region.regionType());
    return ResponseEntity.ok(Map.of("ok", true, "status", "listening", "region_id", region.regionId()));
  }

  @PostMapping("/api/listening/stop")
  public ResponseEntity<?> stop(@RequestHeader(name = "Authorization", required = false) String auth) {
    var session = jwt.fromAuthorization(auth).orElse(null);
    if (session == null) return ResponseEntity.status(401).body(ApiError.of("INVALID_TOKEN", "Authentication required."));
    poller.remove(session.userId());
    return ResponseEntity.ok(Map.of("ok", true, "status", "off"));
  }

  @GetMapping("/api/listening/status")
  public ResponseEntity<?> status(@RequestHeader(name = "Authorization", required = false) String auth) {
    var session = jwt.fromAuthorization(auth).orElse(null);
    if (session == null) return ResponseEntity.status(401).body(ApiError.of("INVALID_TOKEN", "Authentication required."));
    return ResponseEntity.ok(poller.status(session.userId()));
  }
}
