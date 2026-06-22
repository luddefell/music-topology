package com.soundscapemap.api.model;

import java.util.List;
import java.util.Map;

public record RegionSnapshot(
    String region_id,
    String region_type,
    String h3_cell,
    String name,
    String subtitle,
    String dominant_genre,
    Map<String, Double> genre_scores,
    int vote_count,
    int unique_user_count,
    List<TrackSummary> top_tracks,
    String computed_at
) {}
