package com.soundscapemap.api.service;

import com.soundscapemap.api.config.AppProperties;
import com.soundscapemap.api.repository.SoundscapeRepository;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class SpotifyService {
  private static final List<String> SCOPES = List.of("user-read-playback-state", "user-read-currently-playing", "user-read-recently-played");
  private final SecureRandom random = new SecureRandom();
  private final RestClient rest = RestClient.create();
  private final AppProperties properties;
  private final GenreService genres;
  private final SoundscapeRepository repository;

  public SpotifyService(AppProperties properties, GenreService genres, SoundscapeRepository repository) {
    this.properties = properties;
    this.genres = genres;
    this.repository = repository;
  }

  public boolean configured() {
    return properties.spotifyClientId() != null && !properties.spotifyClientId().isBlank();
  }

  public List<String> scopes() {
    return SCOPES;
  }

  public StartAuth startAuth() {
    String verifier = randomBase64(96);
    String state = randomBase64(24);
    String params = "client_id=" + enc(properties.spotifyClientId())
        + "&response_type=code"
        + "&redirect_uri=" + enc(properties.spotifyRedirectUri())
        + "&code_challenge_method=S256"
        + "&code_challenge=" + enc(codeChallenge(verifier))
        + "&state=" + enc(state)
        + "&scope=" + enc(String.join(" ", SCOPES));
    return new StartAuth("https://accounts.spotify.com/authorize?" + params, verifier, state);
  }

  public TokenResponse exchangeCode(String code, String verifier) {
    LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("grant_type", "authorization_code");
    form.add("code", code);
    form.add("redirect_uri", properties.spotifyRedirectUri());
    form.add("client_id", properties.spotifyClientId());
    form.add("code_verifier", verifier);
    return postToken(form);
  }

  public TokenResponse refresh(String refreshToken) {
    LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("grant_type", "refresh_token");
    form.add("refresh_token", refreshToken);
    form.add("client_id", properties.spotifyClientId());
    if (properties.spotifyClientSecret() != null && !properties.spotifyClientSecret().isBlank()) {
      form.add("client_secret", properties.spotifyClientSecret());
    }
    return postToken(form);
  }

  public SoundscapeRepository.StoredToken validTokenForUser(String userId) {
    SoundscapeRepository.StoredToken token = repository.spotifyTokenForUser(userId);
    if (token == null) return null;
    if (token.expiresAt() != null && token.expiresAt().isAfter(Instant.now().plusSeconds(45))) return token;
    if (token.refreshToken() == null || token.refreshToken().isBlank()) return null;
    TokenResponse refreshed = refresh(token.refreshToken());
    repository.saveSpotifyToken(userId, refreshed.accessToken(), refreshed.refreshToken(), refreshed.expiresIn());
    return repository.spotifyTokenForUser(userId);
  }

  public SpotifyProfile profile(String accessToken) {
    Map<?, ?> json = rest.get()
        .uri("https://api.spotify.com/v1/me")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
        .retrieve()
        .body(Map.class);
    return new SpotifyProfile(String.valueOf(json.get("id")));
  }

  public List<TrackResult> searchTracks(String accessToken, String query) {
    URI uri = URI.create("https://api.spotify.com/v1/search?type=track&limit=8&q=" + enc(query));
    Map<?, ?> json = rest.get()
        .uri(uri)
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
        .retrieve()
        .body(Map.class);
    Map<?, ?> tracksObject = (Map<?, ?>) json.get("tracks");
    List<?> items = tracksObject == null ? List.of() : listValue(tracksObject, "items");
    List<TrackParts> parts = new ArrayList<>();
    List<String> artistIds = new ArrayList<>();
    for (Object raw : items) {
      Map<?, ?> track = (Map<?, ?>) raw;
      List<?> artists = listValue(track, "artists");
      List<String> names = new ArrayList<>();
      List<String> ids = new ArrayList<>();
      for (Object artistRaw : artists) {
        Map<?, ?> artist = (Map<?, ?>) artistRaw;
        names.add(String.valueOf(artist.get("name")));
        String id = String.valueOf(artist.get("id"));
        ids.add(id);
        artistIds.add(id);
      }
      parts.add(new TrackParts(
          String.valueOf(track.get("uri")),
          String.valueOf(track.get("name")),
          String.join(", ", names),
          ids,
          albumArt(track)
      ));
    }
    Map<String, List<String>> artistGenres = genresForArtists(accessToken, artistIds);
    return parts.stream().map(track -> {
      LinkedHashSet<String> allGenres = new LinkedHashSet<>();
      track.artistIds().forEach(id -> allGenres.addAll(artistGenres.getOrDefault(id, List.of())));
      List<String> spotifyGenres = List.copyOf(allGenres);
      String genreLabel = spotifyGenres.isEmpty() ? "Spotify genre unavailable" : String.join(", ", spotifyGenres.subList(0, Math.min(2, spotifyGenres.size())));
      return new TrackResult(track.id(), track.name(), track.artist(), genres.classify(spotifyGenres), genreLabel, spotifyGenres, track.albumArt());
    }).toList();
  }

  public CurrentTrack currentlyPlaying(String accessToken) {
    Map<?, ?> json = rest.get()
        .uri("https://api.spotify.com/v1/me/player/currently-playing")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
        .retrieve()
        .body(Map.class);
    if (json == null || json.get("item") == null) return null;
    Map<?, ?> item = (Map<?, ?>) json.get("item");
    List<?> artists = listValue(item, "artists");
    List<String> names = new ArrayList<>();
    List<String> ids = new ArrayList<>();
    for (Object artistRaw : artists) {
      Map<?, ?> artist = (Map<?, ?>) artistRaw;
      names.add(String.valueOf(artist.get("name")));
      ids.add(String.valueOf(artist.get("id")));
    }
    List<String> spotifyGenres = ids.stream()
        .map(id -> genresForArtists(accessToken, List.of(id)).getOrDefault(id, List.of()))
        .flatMap(List::stream)
        .distinct()
        .toList();
    String genreLabel = spotifyGenres.isEmpty() ? "Spotify genre unavailable" : String.join(", ", spotifyGenres.subList(0, Math.min(2, spotifyGenres.size())));
    return new CurrentTrack(
        String.valueOf(item.get("uri")),
        String.valueOf(item.get("name")),
        String.join(", ", names),
        albumArt(item),
        genres.classify(spotifyGenres),
        genreLabel
    );
  }

  public Map<String, List<String>> genresForArtists(String accessToken, List<String> artistIds) {
    Set<String> ids = new LinkedHashSet<>(artistIds.stream().filter(id -> id != null && !id.isBlank()).limit(20).toList());
    if (ids.isEmpty()) return Map.of();
    Map<?, ?> json = rest.get()
        .uri("https://api.spotify.com/v1/artists?ids=" + String.join(",", ids))
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
        .retrieve()
        .body(Map.class);
    List<?> artists = json == null ? List.of() : listValue(json, "artists");
    java.util.HashMap<String, List<String>> result = new java.util.HashMap<>();
    for (Object raw : artists) {
      Map<?, ?> artist = (Map<?, ?>) raw;
      result.put(String.valueOf(artist.get("id")), listValue(artist, "genres").stream().map(String::valueOf).toList());
    }
    return result;
  }

  private TokenResponse postToken(LinkedMultiValueMap<String, String> form) {
    Map<?, ?> json = rest.post()
        .uri("https://accounts.spotify.com/api/token")
        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
        .body(form)
        .retrieve()
        .body(Map.class);
    return new TokenResponse(
        String.valueOf(json.get("access_token")),
        json.get("refresh_token") == null ? null : String.valueOf(json.get("refresh_token")),
        json.get("expires_in") instanceof Number number ? number.intValue() : 3600
    );
  }

  private String albumArt(Map<?, ?> track) {
    Object albumObject = track.get("album");
    if (!(albumObject instanceof Map<?, ?> album)) return null;
    Object imagesObject = album.get("images");
    if (!(imagesObject instanceof List<?> images) || images.isEmpty()) return null;
    Object first = images.get(0);
    if (!(first instanceof Map<?, ?> image)) return null;
    Object url = image.get("url");
    return url == null ? null : String.valueOf(url);
  }

  private List<?> listValue(Map<?, ?> map, String key) {
    Object value = map.get(key);
    return value instanceof List<?> list ? list : List.of();
  }

  private String randomBase64(int bytes) {
    byte[] data = new byte[bytes];
    random.nextBytes(data);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
  }

  private String codeChallenge(String verifier) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    } catch (Exception error) {
      throw new IllegalStateException("Could not create Spotify code challenge", error);
    }
  }

  private String enc(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private record TrackParts(String id, String name, String artist, List<String> artistIds, String albumArt) {}
  public record StartAuth(String authorizeUrl, String codeVerifier, String state) {}
  public record TokenResponse(String accessToken, String refreshToken, int expiresIn) {}
  public record SpotifyProfile(String id) {}
  public record TrackResult(String id, String name, String artist, String genre, String genre_label, List<String> spotify_genres, String album_art) {}
  public record CurrentTrack(String id, String name, String artist, String albumArt, String genre, String genreLabel) {}
}
