package com.soundscapemap.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "soundscape")
public record AppProperties(
    String publicWebOrigin,
    String spotifyClientId,
    String spotifyClientSecret,
    String spotifyRedirectUri,
    String jwtSecret,
    boolean enableAutoVote,
    String regionServiceUrl,
    int mlEventWindowMinutes,
    int mlMinEventsPerTile,
    double mlMusicSimilarityThreshold,
    double mlSpatialWeight,
    double mlSameUserRepeatPenalty,
    double mlListeningWeight,
    double mlManualVoteWeight,
    String mlLlmDescriptorUrl,
    String mlLlmApiKey,
    String mlLlmModel
) {}
