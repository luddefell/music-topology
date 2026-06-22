CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension is unavailable; continuing with plain PostgreSQL tables for local development.';
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT UNIQUE,
  device_hash TEXT UNIQUE,
  encrypted_refresh_token TEXT,
  spotify_access_token TEXT,
  spotify_token_expires_at TIMESTAMPTZ,
  auto_vote_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  h3_cell TEXT NOT NULL,
  region_id TEXT,
  region_type TEXT DEFAULT 'h3',
  track_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  weight FLOAT DEFAULT 1.0,
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT CHECK (source IN ('vote', 'listening')),
  PRIMARY KEY (id, voted_at)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_hypertable') THEN
    EXECUTE 'SELECT create_hypertable(''votes'', ''voted_at'', if_not_exists => TRUE)';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS votes_h3_cell_voted_at_idx ON votes (h3_cell, voted_at DESC);
CREATE INDEX IF NOT EXISTS votes_user_cell_window_idx ON votes (user_id, h3_cell, voted_at DESC);
CREATE INDEX IF NOT EXISTS votes_region_voted_at_idx ON votes (region_id, voted_at DESC);
CREATE INDEX IF NOT EXISTS votes_user_region_window_idx ON votes (user_id, region_id, voted_at DESC);

CREATE TABLE IF NOT EXISTS region_snapshots (
  h3_cell TEXT NOT NULL,
  region_id TEXT,
  region_type TEXT DEFAULT 'h3',
  name TEXT,
  subtitle TEXT,
  dominant_genre TEXT NOT NULL,
  genre_scores JSONB NOT NULL,
  vote_count INT NOT NULL,
  unique_user_count INT DEFAULT 0,
  top_tracks JSONB DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (h3_cell, computed_at)
);

CREATE TABLE IF NOT EXISTS spotify_cache (
  track_id TEXT PRIMARY KEY,
  name TEXT,
  artist TEXT,
  album_art TEXT,
  inferred_genre TEXT,
  genre_label TEXT,
  artist_id TEXT,
  genres TEXT[],
  audio_features JSONB,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS region_clusters (
  id BIGSERIAL PRIMARY KEY,
  cluster_id INT NOT NULL,
  model_version TEXT NOT NULL,
  h3_cells TEXT[] NOT NULL,
  dominant_genre TEXT NOT NULL,
  genre_scores JSONB,
  audio_features JSONB,
  vibe_label TEXT,
  confidence FLOAT,
  geojson JSONB,
  is_transition BOOLEAN DEFAULT FALSE,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS region_clusters_computed_at_idx ON region_clusters (computed_at DESC);
CREATE INDEX IF NOT EXISTS region_clusters_h3_cells_idx ON region_clusters USING GIN (h3_cells);

CREATE TABLE IF NOT EXISTS cluster_quality_log (
  computed_at TIMESTAMPTZ PRIMARY KEY DEFAULT NOW(),
  model TEXT,
  n_clusters INT,
  n_noise_cells INT,
  silhouette_score FLOAT,
  davies_bouldin FLOAT,
  fit_duration_ms INT
);

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

CREATE MATERIALIZED VIEW IF NOT EXISTS region_current_scores AS
SELECT
  h3_cell,
  genre,
  SUM(weight * POWER(0.5, EXTRACT(EPOCH FROM (NOW() - voted_at)) / 60.0 / 45.0)) AS score,
  COUNT(*) AS vote_count
FROM votes
WHERE voted_at > NOW() - INTERVAL '2 hours'
GROUP BY h3_cell, genre;
