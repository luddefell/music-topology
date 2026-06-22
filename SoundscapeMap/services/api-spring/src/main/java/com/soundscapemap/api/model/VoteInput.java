package com.soundscapemap.api.model;

public record VoteInput(
    String userId,
    String regionId,
    String regionType,
    String h3Cell,
    String trackId,
    String trackName,
    String artist,
    String albumArt,
    String genre,
    String genreLabel,
    double weight,
    String source
) {}
