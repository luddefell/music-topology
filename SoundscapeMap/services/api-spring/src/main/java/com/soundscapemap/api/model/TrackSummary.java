package com.soundscapemap.api.model;

public record TrackSummary(
    String track_id,
    int count,
    String name,
    String artist,
    String album_art,
    String genre_label
) {}
