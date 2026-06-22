package com.soundscapemap.api.controller;

import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.service.RateLimiterService;
import com.soundscapemap.api.service.SpotifyService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SearchController {
  private final SpotifyService spotify;
  private final RateLimiterService limiter;

  private static final List<Map<String, Object>> SEED_TRACKS = List.of(
      Map.of("id", "spotify:track:4iV5W9uYEdYUVa79Axb7Rh", "name", "DID IT AGAIN", "artist", "Travy, Elzzz, Fred again..", "genre", "electronic", "genre_label", "electronic", "album_art", ""),
      Map.of("id", "spotify:track:7ouMYWpwJ422jRcDASZB7P", "name", "Blue Hour Walk", "artist", "Lakefront Trio", "genre", "jazz", "genre_label", "vocal jazz", "album_art", ""),
      Map.of("id", "spotify:track:2takcwOaAZWiXQijPHIx7B", "name", "Transit Anthem", "artist", "South Loop", "genre", "hiphop", "genre_label", "hip hop", "album_art", "")
  );

  public SearchController(SpotifyService spotify, RateLimiterService limiter) {
    this.spotify = spotify;
    this.limiter = limiter;
  }

  @GetMapping("/api/search/tracks")
  public ResponseEntity<?> search(@RequestParam(name = "q", defaultValue = "") String q, HttpServletRequest request) {
    RateLimiterService.Result allowed = limiter.allow("search:" + request.getRemoteAddr(), 30, 60);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "SEARCH_RATE_LIMITED", "message", "Too many search requests.", "retry_after", allowed.retryAfter())));

    String query = q.trim();
    if (query.length() < 2) return ResponseEntity.ok(Map.of("tracks", List.of()));
    try {
      if (!spotify.catalogSearchConfigured()) {
        String lower = query.toLowerCase(Locale.ROOT);
        List<Map<String, Object>> matches = SEED_TRACKS.stream()
            .filter(track -> (track.get("name") + " " + track.get("artist") + " " + track.get("genre")).toLowerCase(Locale.ROOT).contains(lower))
            .limit(10)
            .toList();
        return ResponseEntity.ok(Map.of("source", "seed", "tracks", matches));
      }
      return ResponseEntity.ok(Map.of("source", "spotify", "tracks", spotify.searchCatalogTracks(query)));
    } catch (SpotifyService.SpotifyApiException error) {
      if (error.statusCode() == 403) {
        return ResponseEntity.status(403).body(ApiError.of(
            "SPOTIFY_SEARCH_FORBIDDEN",
            "Spotify refused app catalog search. Check that the Spotify Client ID and Client Secret belong to the same app and that Web API is enabled. Spotify response: " + error.responseBody()
        ));
      }
      return ResponseEntity.status(502).body(ApiError.of("SPOTIFY_SEARCH_FAILED", "Spotify track search failed: " + error.responseBody()));
    } catch (Exception error) {
      return ResponseEntity.status(502).body(ApiError.of("SPOTIFY_SEARCH_FAILED", "Spotify track search failed: " + error.getMessage()));
    }
  }
}
