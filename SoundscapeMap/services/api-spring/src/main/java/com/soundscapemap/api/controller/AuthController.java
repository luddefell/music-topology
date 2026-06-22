package com.soundscapemap.api.controller;

import com.soundscapemap.api.config.AppProperties;
import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.model.UserSession;
import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.service.JwtService;
import com.soundscapemap.api.service.SpotifyService;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AppProperties properties;
  private final SpotifyService spotify;
  private final SoundscapeRepository repository;
  private final JwtService jwt;
  private final SecureRandom random = new SecureRandom();

  public AuthController(AppProperties properties, SpotifyService spotify, SoundscapeRepository repository, JwtService jwt) {
    this.properties = properties;
    this.spotify = spotify;
    this.repository = repository;
    this.jwt = jwt;
  }

  @GetMapping("/spotify/config")
  public Map<String, Object> spotifyConfig() {
    return Map.of(
        "configured", spotify.configured(),
        "redirect_uri", properties.spotifyRedirectUri(),
        "uses_client_secret", properties.spotifyClientSecret() != null && !properties.spotifyClientSecret().isBlank(),
        "required_scopes", spotify.scopes()
    );
  }

  @GetMapping("/spotify/start")
  public ResponseEntity<?> spotifyStart() {
    if (!spotify.configured()) {
      return ResponseEntity.ok(Map.of(
          "configured", false,
          "error", Map.of("code", "SPOTIFY_NOT_CONFIGURED", "message", "Set SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI in .env, then restart the API.")
      ));
    }
    SpotifyService.StartAuth start = spotify.startAuth();
    return ResponseEntity.ok(Map.of(
        "configured", true,
        "authorize_url", start.authorizeUrl(),
        "code_verifier", start.codeVerifier(),
        "state", start.state()
    ));
  }

  @PostMapping("/spotify/callback")
  public ResponseEntity<?> spotifyCallback(@RequestBody Map<String, Object> body) {
    if (!spotify.configured()) {
      return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ApiError.of("SPOTIFY_NOT_CONFIGURED", "Spotify credentials are not configured."));
    }
    String code = body.get("code") == null ? "" : String.valueOf(body.get("code"));
    String verifier = body.get("code_verifier") == null ? "" : String.valueOf(body.get("code_verifier"));
    if (code.isBlank() || verifier.length() < 43) {
      return ResponseEntity.badRequest().body(ApiError.of("INVALID_AUTH_CALLBACK", "Invalid Spotify callback payload."));
    }
    try {
      SpotifyService.TokenResponse token = spotify.exchangeCode(code, verifier);
      SpotifyService.SpotifyProfile profile = spotify.profile(token.accessToken());
      String userId = repository.upsertSpotifyUser(profile.id());
      repository.saveSpotifyToken(userId, token.accessToken(), token.refreshToken(), token.expiresIn());
      String issued = jwt.issue(new UserSession(userId, profile.id(), false));
      return ResponseEntity.ok(Map.of("jwt", issued, "expires_in", 3600));
    } catch (SpotifyService.SpotifyApiException error) {
      if (error.statusCode() == 403) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of(
            "SPOTIFY_USER_FORBIDDEN",
            "Spotify authorized the login, but refused API access for this account. Add this exact Spotify account to the app's Users Management allowlist and make sure the app owner account has Spotify Premium. Spotify response: " + error.responseBody()
        ));
      }
      return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(ApiError.of("SPOTIFY_PROFILE_FAILED", "Spotify profile lookup failed: " + error.responseBody()));
    } catch (Exception error) {
      return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(ApiError.of("SPOTIFY_TOKEN_EXCHANGE_FAILED", "Spotify token exchange failed: " + error.getMessage()));
    }
  }

  @PostMapping("/anonymous")
  public Map<String, Object> anonymous() throws Exception {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    String userId = repository.upsertAnonymousUser(hash);
    return Map.of("jwt", jwt.issue(new UserSession(userId, null, true)), "expires_in", 3600);
  }
}
