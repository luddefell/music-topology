package com.soundscapemap.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.soundscapemap.api.config.AppProperties;
import com.soundscapemap.api.model.LearnedRegion;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Service
public class MlRegionService {
  private static final String MODEL_VERSION = "metadata-hash-embedding-v1+h3-sidecar-cluster-v1";
  private static final int VECTOR_DIMS = 24;
  private static final int MAX_CLUSTER_GAP = 8;

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper = new ObjectMapper();
  private final GenreService genres;
  private final AppProperties properties;
  private final RestClient rest = RestClient.create();

  public MlRegionService(JdbcTemplate jdbc, GenreService genres, AppProperties properties) {
    this.jdbc = jdbc;
    this.genres = genres;
    this.properties = properties;
  }

  public void ensureSchema() {
    jdbc.execute("""
      CREATE TABLE IF NOT EXISTS track_enrichments (
        track_id TEXT PRIMARY KEY,
        name TEXT,
        artist TEXT,
        album_art TEXT,
        source_genre_label TEXT,
        descriptors JSONB NOT NULL DEFAULT '[]'::jsonb,
        embedding JSONB NOT NULL DEFAULT '[]'::jsonb,
        model_version TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS track_embeddings (
        track_id TEXT PRIMARY KEY REFERENCES track_enrichments(track_id) ON DELETE CASCADE,
        model_version TEXT NOT NULL,
        dimensions INT NOT NULL,
        vector JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tile_music_vectors (
        region_id TEXT PRIMARY KEY,
        region_type TEXT NOT NULL DEFAULT 'h3',
        event_count INT NOT NULL,
        unique_user_count INT NOT NULL,
        genre_scores JSONB NOT NULL,
        descriptors JSONB NOT NULL DEFAULT '[]'::jsonb,
        embedding JSONB NOT NULL,
        model_version TEXT NOT NULL,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS learned_regions (
        region_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        model_version TEXT NOT NULL,
        h3_cells TEXT[] NOT NULL,
        dominant_genre TEXT NOT NULL,
        genre_scores JSONB NOT NULL,
        descriptors JSONB NOT NULL DEFAULT '[]'::jsonb,
        confidence FLOAT NOT NULL,
        event_count INT NOT NULL,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS learned_region_members (
        region_id TEXT REFERENCES learned_regions(region_id) ON DELETE CASCADE,
        h3_cell TEXT NOT NULL,
        confidence FLOAT NOT NULL,
        PRIMARY KEY (region_id, h3_cell)
      );

      CREATE TABLE IF NOT EXISTS ml_run_log (
        id UUID PRIMARY KEY,
        model_version TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ NOT NULL,
        tile_count INT NOT NULL,
        region_count INT NOT NULL,
        hyperparameters JSONB NOT NULL,
        quality JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ml_run_log_finished_at_idx ON ml_run_log (finished_at DESC);
      """);
  }

  public Map<String, Object> hyperparameters() {
    return Map.ofEntries(
        Map.entry("model_version", MODEL_VERSION),
        Map.entry("embedding_model", "deterministic text hash"),
        Map.entry("embedding_dimensions", VECTOR_DIMS),
        Map.entry("event_window_minutes", properties.mlEventWindowMinutes()),
        Map.entry("manual_vote_weight", properties.mlManualVoteWeight()),
        Map.entry("spotify_listening_weight", properties.mlListeningWeight()),
        Map.entry("same_user_repeat_penalty", properties.mlSameUserRepeatPenalty()),
        Map.entry("min_events_per_tile", properties.mlMinEventsPerTile()),
        Map.entry("music_similarity_threshold", properties.mlMusicSimilarityThreshold()),
        Map.entry("spatial_weight", properties.mlSpatialWeight()),
        Map.entry("max_cluster_gap", MAX_CLUSTER_GAP),
        Map.entry("region_service_url", properties.regionServiceUrl()),
        Map.entry("llm_provider", properties.mlLlmApiKey() == null || properties.mlLlmApiKey().isBlank() ? "local fallback descriptor adapter" : "openai via descriptor adapter"),
        Map.entry("llm_model", properties.mlLlmModel() == null ? "" : properties.mlLlmModel()),
        Map.entry("llm_fallback", "local deterministic descriptors")
    );
  }

  public Map<String, Object> rebuildLearnedRegions() {
    Instant started = Instant.now();
    List<VoteSignal> votes = recentVotes();
    Map<String, TileAccumulator> accumulators = new LinkedHashMap<>();
    Map<String, Integer> userTrackSeen = new HashMap<>();
    for (VoteSignal vote : votes) {
      TrackEnrichment enrichment = enrich(vote);
      saveEnrichment(enrichment);
      String repeatKey = (vote.userId() == null ? "anonymous" : vote.userId()) + "|" + vote.trackId();
      int repeatCount = userTrackSeen.merge(repeatKey, 1, Integer::sum);
      double sourceWeight = "listening".equals(vote.source()) ? properties.mlListeningWeight() : properties.mlManualVoteWeight();
      double repeatPenalty = repeatCount > 1 ? properties.mlSameUserRepeatPenalty() : 1.0;
      double weight = sourceWeight * repeatPenalty * timeDecay(vote.votedAt());
      accumulators.computeIfAbsent(vote.regionId(), key -> new TileAccumulator(vote.regionId(), vote.regionType()))
          .add(vote, enrichment, weight);
    }

    List<TileVector> tiles = accumulators.values().stream()
        .map(TileAccumulator::toVector)
        .filter(tile -> tile.eventCount() >= properties.mlMinEventsPerTile())
        .sorted(Comparator.comparing(TileVector::regionId))
        .toList();

    saveTileVectors(tiles);
    ClusterPlan plan = externalCluster(tiles);
    List<List<TileVector>> clusters = plan.clusters().isEmpty() ? cluster(tiles) : plan.clusters();
    List<LearnedRegion> regions = buildRegions(clusters);
    saveLearnedRegions(regions);
    Instant finished = Instant.now();
    Map<String, Object> quality = quality(tiles, regions, Duration.between(started, finished).toMillis(), plan.quality());
    saveRun(started, finished, tiles.size(), regions.size(), quality);
    return Map.of("regions", regions, "quality", quality, "hyperparameters", hyperparameters());
  }

  public List<LearnedRegion> latestLearnedRegions() {
    return jdbc.query("""
      SELECT region_id, label, model_version, h3_cells, dominant_genre, genre_scores, descriptors, confidence, event_count, computed_at
      FROM learned_regions
      ORDER BY computed_at DESC, region_id ASC
      """, this::learnedRegion);
  }

  public Map<String, Object> latestRun() {
    List<Map<String, Object>> rows = jdbc.query("""
      SELECT model_version, started_at, finished_at, tile_count, region_count, hyperparameters, quality
      FROM ml_run_log
      ORDER BY finished_at DESC
      LIMIT 1
      """, (rs, row) -> Map.of(
        "model_version", rs.getString("model_version"),
        "started_at", rs.getTimestamp("started_at").toInstant().toString(),
        "finished_at", rs.getTimestamp("finished_at").toInstant().toString(),
        "tile_count", rs.getInt("tile_count"),
        "region_count", rs.getInt("region_count"),
        "hyperparameters", readMap(rs.getString("hyperparameters")),
        "quality", readMap(rs.getString("quality"))
    ));
    return rows.isEmpty() ? Map.of("model_version", MODEL_VERSION, "hyperparameters", hyperparameters()) : rows.get(0);
  }

  private List<VoteSignal> recentVotes() {
    return jdbc.query("""
      SELECT
        COALESCE(v.region_id, v.h3_cell) AS region_id,
        COALESCE(v.region_type, 'h3') AS region_type,
        v.track_id,
        v.genre,
        v.weight,
        v.source,
        v.voted_at,
        v.user_id::text AS user_id,
        sc.name,
        sc.artist,
        sc.album_art,
        sc.genre_label
      FROM votes v
      LEFT JOIN spotify_cache sc ON sc.track_id = v.track_id
      WHERE v.voted_at > NOW() - (?::TEXT || ' minutes')::INTERVAL
      ORDER BY v.voted_at DESC
      """, this::voteSignal, properties.mlEventWindowMinutes());
  }

  private VoteSignal voteSignal(ResultSet rs, int row) throws java.sql.SQLException {
    Timestamp votedAt = rs.getTimestamp("voted_at");
    return new VoteSignal(
        rs.getString("region_id"),
        rs.getString("region_type"),
        rs.getString("track_id"),
        rs.getString("genre"),
        rs.getDouble("weight"),
        rs.getString("source"),
        votedAt == null ? Instant.now() : votedAt.toInstant(),
        rs.getString("user_id"),
        rs.getString("name"),
        rs.getString("artist"),
        rs.getString("album_art"),
        rs.getString("genre_label")
    );
  }

  private TrackEnrichment enrich(VoteSignal vote) {
    List<String> descriptors = descriptors(vote);
    List<Double> embedding = embedding(String.join(" ", descriptors) + " " + safe(vote.name()) + " " + safe(vote.artist()));
    return new TrackEnrichment(vote.trackId(), vote.name(), vote.artist(), vote.albumArt(), vote.genreLabel(), descriptors, embedding);
  }

  private List<String> descriptors(VoteSignal vote) {
    LinkedHashSet<String> result = new LinkedHashSet<>();
    result.addAll(llmDescriptors(vote));
    String text = (safe(vote.name()) + " " + safe(vote.artist()) + " " + safe(vote.genreLabel()) + " " + safe(vote.genre())).toLowerCase(Locale.ROOT);
    if (text.contains("dance") || text.contains("club") || text.contains("house") || text.contains("techno")) result.add("danceable");
    if (text.contains("study") || text.contains("ambient") || text.contains("lo-fi") || text.contains("jazz")) result.add("study-friendly");
    if (text.contains("rock") || text.contains("punk") || text.contains("drill") || text.contains("trap")) result.add("high-energy");
    if (text.contains("sad") || text.contains("blue") || text.contains("night") || text.contains("moody")) result.add("moody");
    if (text.contains("pop") || text.contains("viral") || text.contains("hit")) result.add("social");
    if (vote.genre() != null && !vote.genre().isBlank() && !"unknown".equals(vote.genre())) {
      result.add("macro:" + vote.genre());
    }
    if (vote.source() != null) result.add("source:" + vote.source());
    if (result.isEmpty()) result.add("open-mix");
    return List.copyOf(result);
  }

  private List<String> llmDescriptors(VoteSignal vote) {
    if (properties.mlLlmDescriptorUrl() == null || properties.mlLlmDescriptorUrl().isBlank()) return List.of();
    try {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("model", properties.mlLlmModel());
      payload.put("track_id", vote.trackId());
      payload.put("name", vote.name());
      payload.put("artist", vote.artist());
      payload.put("genre_label", vote.genreLabel());
      payload.put("fallback_genre", vote.genre());
      payload.put("instruction", "Return concise music descriptors for hyperlocal sound clustering.");
      var request = rest.post()
          .uri(properties.mlLlmDescriptorUrl())
          .body(payload);
      if (properties.mlLlmApiKey() != null && !properties.mlLlmApiKey().isBlank()) {
        request = request.header("Authorization", "Bearer " + properties.mlLlmApiKey());
      }
      Map<?, ?> response = request.retrieve().body(Map.class);
      if (response == null) return List.of();
      return listValue(response, "descriptors").stream()
          .map(String::valueOf)
          .map(value -> value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9:-]+", "-"))
          .filter(value -> !value.isBlank())
          .limit(8)
          .toList();
    } catch (RestClientException | IllegalArgumentException error) {
      return List.of();
    }
  }

  private List<Double> embedding(String text) {
    double[] vector = new double[VECTOR_DIMS];
    for (String token : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
      if (token.isBlank()) continue;
      int hash = token.hashCode();
      int index = Math.floorMod(hash, VECTOR_DIMS);
      vector[index] += (hash & 1) == 0 ? 1.0 : -1.0;
    }
    double norm = 0.0;
    for (double value : vector) norm += value * value;
    norm = Math.sqrt(norm);
    List<Double> result = new ArrayList<>();
    for (double value : vector) result.add(norm == 0 ? 0.0 : value / norm);
    return result;
  }

  private double timeDecay(Instant votedAt) {
    double minutes = Math.max(0, Duration.between(votedAt, Instant.now()).toMillis() / 60000.0);
    return Math.pow(0.5, minutes / 45.0);
  }

  private List<List<TileVector>> cluster(List<TileVector> tiles) {
    Map<String, TileVector> byId = new HashMap<>();
    tiles.forEach(tile -> byId.put(tile.regionId(), tile));
    Set<String> visited = new HashSet<>();
    List<List<TileVector>> clusters = new ArrayList<>();
    for (TileVector seed : tiles) {
      if (!visited.add(seed.regionId())) continue;
      List<TileVector> cluster = new ArrayList<>();
      ArrayDeque<TileVector> queue = new ArrayDeque<>();
      queue.add(seed);
      while (!queue.isEmpty()) {
        TileVector current = queue.removeFirst();
        cluster.add(current);
        for (TileVector candidate : tiles) {
          if (visited.contains(candidate.regionId())) continue;
          if (graphSimilarity(current, candidate) >= properties.mlMusicSimilarityThreshold()) {
            visited.add(candidate.regionId());
            queue.add(candidate);
          }
        }
      }
      clusters.add(cluster);
    }
    return clusters;
  }

  private double graphSimilarity(TileVector a, TileVector b) {
    double music = cosine(a.embedding(), b.embedding());
    double spatial = spatialAffinity(a.regionId(), b.regionId());
    double spatialWeight = Math.max(0.0, Math.min(0.95, properties.mlSpatialWeight()));
    return music * (1.0 - spatialWeight) + spatial * spatialWeight;
  }

  private double spatialAffinity(String a, String b) {
    int shared = 0;
    int max = Math.min(a.length(), b.length());
    while (shared < max && a.charAt(shared) == b.charAt(shared)) shared++;
    int suffixGap = Math.abs(safeHexTail(a) - safeHexTail(b));
    double prefix = Math.min(1.0, shared / 10.0);
    double gap = suffixGap <= MAX_CLUSTER_GAP ? 1.0 : Math.max(0.0, 1.0 - (suffixGap / 96.0));
    return (prefix + gap) / 2.0;
  }

  private int safeHexTail(String value) {
    String cleaned = value.replaceAll("[^0-9a-fA-F]", "");
    if (cleaned.length() < 4) return 0;
    return Integer.parseInt(cleaned.substring(cleaned.length() - 4, cleaned.length() - 2), 16);
  }

  private double cosine(List<Double> a, List<Double> b) {
    double dot = 0.0;
    double normA = 0.0;
    double normB = 0.0;
    for (int i = 0; i < Math.min(a.size(), b.size()); i++) {
      dot += a.get(i) * b.get(i);
      normA += a.get(i) * a.get(i);
      normB += b.get(i) * b.get(i);
    }
    if (normA == 0 || normB == 0) return 0.0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private List<LearnedRegion> buildRegions(List<List<TileVector>> clusters) {
    List<LearnedRegion> regions = new ArrayList<>();
    int index = 1;
    for (List<TileVector> cluster : clusters) {
      Map<String, Double> scores = new HashMap<>();
      LinkedHashSet<String> descriptors = new LinkedHashSet<>();
      int eventCount = 0;
      for (TileVector tile : cluster) {
        eventCount += tile.eventCount();
        descriptors.addAll(tile.descriptors());
        tile.genreScores().forEach((genre, score) -> scores.merge(genre, score, Double::sum));
      }
      String dominant = genres.dominantGenre(scores);
      List<String> topDescriptors = descriptors.stream().limit(5).toList();
      double confidence = confidence(cluster);
      regions.add(new LearnedRegion(
          "learned:" + index++,
          regionLabel(dominant, topDescriptors),
          MODEL_VERSION,
          cluster.stream().map(TileVector::regionId).toList(),
          dominant,
          scores,
          topDescriptors,
          confidence,
          eventCount,
          Instant.now().toString()
      ));
    }
    return regions;
  }

  private String regionLabel(String dominant, List<String> descriptors) {
    String descriptor = descriptors.stream()
        .filter(value -> !value.startsWith("macro:") && !value.startsWith("source:"))
        .findFirst()
        .orElse("learned");
    if (dominant == null || dominant.isBlank() || "unknown".equals(dominant)) {
      return title(descriptor) + " Zone";
    }
    String genre = dominant == null ? "mixed" : dominant.replace("hiphop", "hip-hop");
    return title(descriptor) + " " + title(genre) + " Zone";
  }

  private String title(String value) {
    String spaced = value.replace('-', ' ');
    if (spaced.isBlank()) return "Open";
    return spaced.substring(0, 1).toUpperCase(Locale.ROOT) + spaced.substring(1);
  }

  private double confidence(List<TileVector> cluster) {
    double avgEvents = cluster.stream().mapToInt(TileVector::eventCount).average().orElse(0.0);
    double cohesion = 1.0;
    int pairs = 0;
    double total = 0.0;
    for (int i = 0; i < cluster.size(); i++) {
      for (int j = i + 1; j < cluster.size(); j++) {
        pairs++;
        total += Math.max(0.0, graphSimilarity(cluster.get(i), cluster.get(j)));
      }
    }
    if (pairs > 0) cohesion = total / pairs;
    return Math.max(0.18, Math.min(0.98, cohesion * 0.72 + Math.min(1.0, avgEvents / 8.0) * 0.28));
  }

  private ClusterPlan externalCluster(List<TileVector> tiles) {
    if (properties.regionServiceUrl() == null || properties.regionServiceUrl().isBlank() || tiles.isEmpty()) {
      return new ClusterPlan(List.of(), Map.of("cluster_source", "java_fallback"));
    }
    try {
      List<Map<String, Object>> payload = tiles.stream()
          .map(tile -> Map.<String, Object>of(
              "h3_cell", tile.regionId(),
              "genre_scores", tile.genreScores(),
              "vote_count", tile.eventCount(),
              "vote_density", tile.eventCount()
          ))
          .toList();
      Map<?, ?> response = rest.post()
          .uri(properties.regionServiceUrl() + "/regions/cluster")
          .body(payload)
          .retrieve()
          .body(Map.class);
      if (response == null) return new ClusterPlan(List.of(), Map.of("cluster_source", "java_fallback"));
      Map<String, TileVector> byId = new HashMap<>();
      tiles.forEach(tile -> byId.put(tile.regionId(), tile));
      List<List<TileVector>> clusters = new ArrayList<>();
      for (Object raw : listValue(response, "features")) {
        if (!(raw instanceof Map<?, ?> feature)) continue;
        Object propertiesObject = feature.get("properties");
        if (!(propertiesObject instanceof Map<?, ?> featureProperties)) continue;
        List<TileVector> members = listValue(featureProperties, "h3_cells").stream()
            .map(String::valueOf)
            .map(byId::get)
            .filter(java.util.Objects::nonNull)
            .toList();
        if (!members.isEmpty()) clusters.add(members);
      }
      Object qualityObject = response.get("quality");
      Map<String, Object> quality = new HashMap<>(readMap(json(qualityObject == null ? Map.of() : qualityObject)));
      quality.put("cluster_source", "python_h3_sidecar");
      return new ClusterPlan(clusters, quality);
    } catch (RestClientException | IllegalArgumentException error) {
      return new ClusterPlan(List.of(), Map.of("cluster_source", "java_fallback", "sidecar_error", error.getMessage()));
    }
  }

  private Map<String, Object> quality(List<TileVector> tiles, List<LearnedRegion> regions, long durationMs, Map<String, Object> sidecarQuality) {
    double avgConfidence = regions.stream().mapToDouble(LearnedRegion::confidence).average().orElse(0.0);
    Map<String, Object> quality = new LinkedHashMap<>();
    quality.put("model", MODEL_VERSION);
    quality.put("tile_count", tiles.size());
    quality.put("region_count", regions.size());
    quality.put("average_confidence", avgConfidence);
    quality.put("fit_duration_ms", durationMs);
    quality.putAll(sidecarQuality);
    return quality;
  }

  private void saveEnrichment(TrackEnrichment enrichment) {
    jdbc.update("""
      INSERT INTO track_enrichments (track_id, name, artist, album_art, source_genre_label, descriptors, embedding, model_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, NOW())
      ON CONFLICT (track_id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, track_enrichments.name),
        artist = COALESCE(EXCLUDED.artist, track_enrichments.artist),
        album_art = COALESCE(EXCLUDED.album_art, track_enrichments.album_art),
        source_genre_label = COALESCE(EXCLUDED.source_genre_label, track_enrichments.source_genre_label),
        descriptors = EXCLUDED.descriptors,
        embedding = EXCLUDED.embedding,
        model_version = EXCLUDED.model_version,
        updated_at = NOW()
      """, enrichment.trackId(), enrichment.name(), enrichment.artist(), enrichment.albumArt(), enrichment.genreLabel(), json(enrichment.descriptors()), json(enrichment.embedding()), MODEL_VERSION);
    jdbc.update("""
      INSERT INTO track_embeddings (track_id, model_version, dimensions, vector, updated_at)
      VALUES (?, ?, ?, ?::jsonb, NOW())
      ON CONFLICT (track_id) DO UPDATE SET model_version = EXCLUDED.model_version, dimensions = EXCLUDED.dimensions, vector = EXCLUDED.vector, updated_at = NOW()
      """, enrichment.trackId(), MODEL_VERSION, VECTOR_DIMS, json(enrichment.embedding()));
  }

  private void saveTileVectors(List<TileVector> tiles) {
    for (TileVector tile : tiles) {
      jdbc.update("""
        INSERT INTO tile_music_vectors (region_id, region_type, event_count, unique_user_count, genre_scores, descriptors, embedding, model_version, computed_at)
        VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, NOW())
        ON CONFLICT (region_id) DO UPDATE SET
          region_type = EXCLUDED.region_type,
          event_count = EXCLUDED.event_count,
          unique_user_count = EXCLUDED.unique_user_count,
          genre_scores = EXCLUDED.genre_scores,
          descriptors = EXCLUDED.descriptors,
          embedding = EXCLUDED.embedding,
          model_version = EXCLUDED.model_version,
          computed_at = NOW()
        """, tile.regionId(), tile.regionType(), tile.eventCount(), tile.uniqueUserCount(), json(tile.genreScores()), json(tile.descriptors()), json(tile.embedding()), MODEL_VERSION);
    }
  }

  private void saveLearnedRegions(List<LearnedRegion> regions) {
    jdbc.update("DELETE FROM learned_region_members");
    jdbc.update("DELETE FROM learned_regions");
    for (LearnedRegion region : regions) {
      jdbc.update("""
        INSERT INTO learned_regions (region_id, label, model_version, h3_cells, dominant_genre, genre_scores, descriptors, confidence, event_count, computed_at)
        VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, NOW())
        """,
        region.region_id(),
        region.label(),
        region.model_version(),
        textArray(region.h3_cells()),
        region.dominant_genre(),
        json(region.genre_scores()),
        json(region.descriptors()),
        region.confidence(),
        region.event_count()
      );
      for (String h3 : region.h3_cells()) {
        jdbc.update("INSERT INTO learned_region_members (region_id, h3_cell, confidence) VALUES (?, ?, ?)", region.region_id(), h3, region.confidence());
      }
    }
  }

  private void saveRun(Instant started, Instant finished, int tileCount, int regionCount, Map<String, Object> quality) {
    jdbc.update("""
      INSERT INTO ml_run_log (id, model_version, started_at, finished_at, tile_count, region_count, hyperparameters, quality)
      VALUES (?::uuid, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)
      """, UUID.randomUUID().toString(), MODEL_VERSION, Timestamp.from(started), Timestamp.from(finished), tileCount, regionCount, json(hyperparameters()), json(quality));
  }

  private Array textArray(List<String> values) {
    return jdbc.execute((ConnectionCallback<Array>) connection -> connection.createArrayOf("text", values.toArray(String[]::new)));
  }

  private LearnedRegion learnedRegion(ResultSet rs, int row) throws java.sql.SQLException {
    return new LearnedRegion(
        rs.getString("region_id"),
        rs.getString("label"),
        rs.getString("model_version"),
        List.of((String[]) rs.getArray("h3_cells").getArray()),
        rs.getString("dominant_genre"),
        readDoubleMap(rs.getString("genre_scores")),
        readList(rs.getString("descriptors")),
        rs.getDouble("confidence"),
        rs.getInt("event_count"),
        rs.getTimestamp("computed_at").toInstant().toString()
    );
  }

  private String json(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (Exception error) {
      throw new IllegalStateException("Could not write ML JSON", error);
    }
  }

  private Map<String, Object> readMap(String json) {
    try {
      return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
    } catch (Exception error) {
      return Map.of();
    }
  }

  private Map<String, Double> readDoubleMap(String json) {
    try {
      return mapper.readValue(json, new TypeReference<Map<String, Double>>() {});
    } catch (Exception error) {
      return Map.of();
    }
  }

  private List<String> readList(String json) {
    try {
      return mapper.readValue(json, new TypeReference<List<String>>() {});
    } catch (Exception error) {
      return List.of();
    }
  }

  private String safe(String value) {
    return value == null ? "" : value;
  }

  private List<?> listValue(Map<?, ?> map, String key) {
    Object value = map.get(key);
    return value instanceof List<?> list ? list : List.of();
  }

  private record VoteSignal(String regionId, String regionType, String trackId, String genre, double weight, String source, Instant votedAt, String userId, String name, String artist, String albumArt, String genreLabel) {}
  private record TrackEnrichment(String trackId, String name, String artist, String albumArt, String genreLabel, List<String> descriptors, List<Double> embedding) {}
  private record TileVector(String regionId, String regionType, int eventCount, int uniqueUserCount, Map<String, Double> genreScores, List<String> descriptors, List<Double> embedding) {}
  private record ClusterPlan(List<List<TileVector>> clusters, Map<String, Object> quality) {}

  private final class TileAccumulator {
    private final String regionId;
    private final String regionType;
    private final Map<String, Double> genreScores = new HashMap<>();
    private final Set<String> users = new HashSet<>();
    private final LinkedHashSet<String> descriptors = new LinkedHashSet<>();
    private final double[] embedding = new double[VECTOR_DIMS];
    private int eventCount = 0;
    private double totalWeight = 0.0;

    private TileAccumulator(String regionId, String regionType) {
      this.regionId = regionId;
      this.regionType = regionType == null ? "h3" : regionType;
    }

    private void add(VoteSignal vote, TrackEnrichment enrichment, double weight) {
      eventCount++;
      if (vote.userId() != null) users.add(vote.userId());
      if (vote.genre() != null && !vote.genre().isBlank() && !"unknown".equals(vote.genre())) {
        genreScores.merge(vote.genre(), weight * Math.max(0.01, vote.weight()), Double::sum);
      }
      descriptors.addAll(enrichment.descriptors());
      for (int i = 0; i < Math.min(embedding.length, enrichment.embedding().size()); i++) {
        embedding[i] += enrichment.embedding().get(i) * weight;
      }
      totalWeight += weight;
    }

    private TileVector toVector() {
      List<Double> normalized = new ArrayList<>();
      double norm = 0.0;
      for (double value : embedding) norm += value * value;
      norm = Math.sqrt(norm);
      for (double value : embedding) normalized.add(norm == 0 ? 0.0 : value / norm);
      return new TileVector(regionId, regionType, eventCount, users.size(), genreScores, descriptors.stream().limit(8).toList(), totalWeight == 0 ? embedding("") : normalized);
    }
  }
}
