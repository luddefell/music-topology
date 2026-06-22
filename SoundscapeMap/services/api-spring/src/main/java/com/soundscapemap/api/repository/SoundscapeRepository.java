package com.soundscapemap.api.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.soundscapemap.api.model.RegionSnapshot;
import com.soundscapemap.api.model.TrackSummary;
import com.soundscapemap.api.model.VoteInput;
import com.soundscapemap.api.service.CornellRegionService;
import com.soundscapemap.api.service.GenreService;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SoundscapeRepository {
  private final JdbcTemplate jdbc;
  private final GenreService genres;
  private final CornellRegionService cornell;
  private final ObjectMapper mapper = new ObjectMapper();

  public SoundscapeRepository(JdbcTemplate jdbc, GenreService genres, CornellRegionService cornell) {
    this.jdbc = jdbc;
    this.genres = genres;
    this.cornell = cornell;
  }

  public void ensureSchema() {
    jdbc.execute("""
      ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_access_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_token_expires_at TIMESTAMPTZ;
      ALTER TABLE spotify_cache ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE spotify_cache ADD COLUMN IF NOT EXISTS artist TEXT;
      ALTER TABLE spotify_cache ADD COLUMN IF NOT EXISTS album_art TEXT;
      ALTER TABLE spotify_cache ADD COLUMN IF NOT EXISTS inferred_genre TEXT;
      ALTER TABLE spotify_cache ADD COLUMN IF NOT EXISTS genre_label TEXT;
      ALTER TABLE votes ADD COLUMN IF NOT EXISTS region_id TEXT;
      ALTER TABLE votes ADD COLUMN IF NOT EXISTS region_type TEXT DEFAULT 'h3';
      ALTER TABLE region_snapshots ADD COLUMN IF NOT EXISTS region_id TEXT;
      ALTER TABLE region_snapshots ADD COLUMN IF NOT EXISTS region_type TEXT DEFAULT 'h3';
      ALTER TABLE region_snapshots ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE region_snapshots ADD COLUMN IF NOT EXISTS subtitle TEXT;
      ALTER TABLE region_snapshots ADD COLUMN IF NOT EXISTS unique_user_count INTEGER DEFAULT 0;
      """);
  }

  public void ping() {
    jdbc.queryForObject("SELECT 1", Integer.class);
  }

  public String upsertAnonymousUser(String deviceHash) {
    List<String> existing = jdbc.query("SELECT id::text FROM users WHERE device_hash = ? LIMIT 1", (rs, row) -> rs.getString(1), deviceHash);
    if (!existing.isEmpty()) return existing.get(0);
    return jdbc.queryForObject("INSERT INTO users (device_hash) VALUES (?) RETURNING id::text", String.class, deviceHash);
  }

  public String upsertSpotifyUser(String spotifyId) {
    return jdbc.queryForObject("""
      INSERT INTO users (spotify_id)
      VALUES (?)
      ON CONFLICT (spotify_id) DO UPDATE SET spotify_id = EXCLUDED.spotify_id
      RETURNING id::text
      """, String.class, spotifyId);
  }

  public void saveSpotifyToken(String userId, String accessToken, String refreshToken, int expiresIn) {
    jdbc.update("""
      UPDATE users
      SET spotify_access_token = ?,
          encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
          spotify_token_expires_at = NOW() + (?::TEXT || ' seconds')::INTERVAL
      WHERE id = ?::uuid
      """, accessToken, refreshToken, expiresIn, userId);
  }

  public StoredToken spotifyTokenForUser(String userId) {
    List<StoredToken> tokens = jdbc.query("""
      SELECT spotify_access_token, encrypted_refresh_token, spotify_token_expires_at
      FROM users WHERE id = ?::uuid LIMIT 1
      """, (rs, row) -> new StoredToken(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant()), userId);
    return tokens.isEmpty() ? null : tokens.get(0);
  }

  public void forgetSpotifyToken(String userId) {
    jdbc.update("UPDATE users SET spotify_access_token = NULL, spotify_token_expires_at = NULL WHERE id = ?::uuid", userId);
  }

  public void insertVote(VoteInput vote) {
    upsertTrackMetadata(vote);
    jdbc.update("""
      INSERT INTO votes (user_id, h3_cell, region_id, region_type, track_id, genre, weight, source)
      VALUES (?::uuid, ?, ?, ?, ?, ?, ?, ?)
      """, vote.userId(), vote.h3Cell(), vote.regionId(), vote.regionType(), vote.trackId(), vote.genre(), vote.weight(), vote.source());
  }

  public RegionSnapshot computeSnapshot(String regionId, String regionType) {
    Instant now = Instant.now();
    List<VoteRow> votes = jdbc.query("""
      SELECT user_id::text, genre, track_id, weight, source, voted_at
      FROM votes
      WHERE COALESCE(region_id, h3_cell) = ? AND voted_at > NOW() - INTERVAL '2 hours'
      ORDER BY voted_at DESC
      """, this::voteRow, regionId);
    Map<String, Double> scores = new HashMap<>();
    Map<String, Integer> trackCounts = new HashMap<>();
    HashSet<String> users = new HashSet<>();
    for (VoteRow vote : votes) {
      scores.merge(vote.genre(), genres.computeWeight(vote.votedAt(), now, vote.weight()), Double::sum);
      trackCounts.merge(vote.trackId(), 1, Integer::sum);
      if (vote.userId() != null) users.add(vote.userId());
    }
    List<TrackSummary> topTracks = topTracks(trackCounts);
    var region = cornell.byId(regionId);
    RegionSnapshot snapshot = new RegionSnapshot(
        regionId,
        region.map(com.soundscapemap.api.model.CornellRegion::regionType).orElse(regionType),
        regionId,
        region.map(com.soundscapemap.api.model.CornellRegion::name).orElse(null),
        region.map(com.soundscapemap.api.model.CornellRegion::subtitle).orElse(null),
        genres.dominantGenre(scores),
        scores,
        votes.size(),
        users.size(),
        topTracks,
        now.toString()
    );
    saveSnapshot(snapshot);
    return snapshot;
  }

  public void deleteUserData(String userId) {
    jdbc.update("UPDATE votes SET user_id = NULL WHERE user_id = ?::uuid", userId);
    jdbc.update("DELETE FROM users WHERE id = ?::uuid", userId);
  }

  private void upsertTrackMetadata(VoteInput vote) {
    if (vote.trackName() == null && vote.artist() == null && vote.albumArt() == null && vote.genreLabel() == null) return;
    jdbc.update("""
      INSERT INTO spotify_cache (track_id, name, artist, album_art, inferred_genre, genre_label)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (track_id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, spotify_cache.name),
        artist = COALESCE(EXCLUDED.artist, spotify_cache.artist),
        album_art = COALESCE(EXCLUDED.album_art, spotify_cache.album_art),
        inferred_genre = COALESCE(EXCLUDED.inferred_genre, spotify_cache.inferred_genre),
        genre_label = COALESCE(EXCLUDED.genre_label, spotify_cache.genre_label),
        cached_at = NOW()
      """, vote.trackId(), vote.trackName(), vote.artist(), vote.albumArt(), vote.genre(), vote.genreLabel());
  }

  private List<TrackSummary> topTracks(Map<String, Integer> trackCounts) {
    List<String> ids = trackCounts.entrySet().stream()
        .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
        .limit(5)
        .map(Map.Entry::getKey)
        .toList();
    if (ids.isEmpty()) return List.of();
    Map<String, TrackMeta> metadata = new HashMap<>();
    jdbc.query("SELECT track_id, name, artist, album_art, genre_label FROM spotify_cache WHERE track_id = ANY(?)",
        ps -> ps.setArray(1, ps.getConnection().createArrayOf("text", ids.toArray())),
        rs -> {
          metadata.put(rs.getString("track_id"), new TrackMeta(rs.getString("name"), rs.getString("artist"), rs.getString("album_art"), rs.getString("genre_label")));
        });
    List<TrackSummary> result = new ArrayList<>();
    for (String id : ids) {
      TrackMeta meta = metadata.get(id);
      result.add(new TrackSummary(id, trackCounts.get(id), meta == null ? null : meta.name(), meta == null ? null : meta.artist(), meta == null ? null : meta.albumArt(), meta == null ? null : meta.genreLabel()));
    }
    return result;
  }

  private void saveSnapshot(RegionSnapshot snapshot) {
    try {
      jdbc.update("""
        INSERT INTO region_snapshots (h3_cell, region_id, region_type, name, subtitle, dominant_genre, genre_scores, vote_count, unique_user_count, top_tracks)
        VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb)
        """,
        snapshot.h3_cell(),
        snapshot.region_id(),
        snapshot.region_type(),
        snapshot.name(),
        snapshot.subtitle(),
        snapshot.dominant_genre(),
        mapper.writeValueAsString(snapshot.genre_scores()),
        snapshot.vote_count(),
        snapshot.unique_user_count(),
        mapper.writeValueAsString(snapshot.top_tracks()));
    } catch (Exception error) {
      throw new IllegalStateException("Failed to persist region snapshot", error);
    }
  }

  private VoteRow voteRow(ResultSet rs, int rowNum) throws java.sql.SQLException {
    Timestamp votedAt = rs.getTimestamp("voted_at");
    return new VoteRow(rs.getString("user_id"), rs.getString("genre"), rs.getString("track_id"), rs.getDouble("weight"), rs.getString("source"), votedAt.toInstant());
  }

  public record StoredToken(String accessToken, String refreshToken, Instant expiresAt) {}
  private record VoteRow(String userId, String genre, String trackId, double weight, String source, Instant votedAt) {}
  private record TrackMeta(String name, String artist, String albumArt, String genreLabel) {}
}
