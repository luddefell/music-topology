package com.soundscapemap.api.model;

import java.util.List;
import java.util.Map;

public record LearnedRegion(
    String region_id,
    String label,
    String model_version,
    List<String> h3_cells,
    String dominant_genre,
    Map<String, Double> genre_scores,
    List<String> descriptors,
    double confidence,
    int event_count,
    String computed_at
) {}
