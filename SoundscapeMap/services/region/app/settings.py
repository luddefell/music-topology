import os


class Settings:
    database_url = os.getenv("DATABASE_URL", "postgresql://soundscape:soundscape@localhost:5432/soundscape")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    region_model = os.getenv("REGION_MODEL", "hdbscan")
    cluster_min_size = int(os.getenv("CLUSTER_MIN_SIZE", "5"))
    cluster_min_votes_per_cell = int(os.getenv("CLUSTER_MIN_VOTES_PER_CELL", "1"))
    cluster_spatial_weight = float(os.getenv("CLUSTER_SPATIAL_WEIGHT", "0.3"))
    cluster_recompute_interval = int(os.getenv("CLUSTER_RECOMPUTE_INTERVAL", "300"))
    fallback_on_degradation = os.getenv("CLUSTER_FALLBACK_ON_DEGRADATION", "true").lower() == "true"


settings = Settings()
