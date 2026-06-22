package com.soundscapemap.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "soundscape")
public record AppProperties(
    String publicWebOrigin,
    String spotifyClientId,
    String spotifyClientSecret,
    String spotifyRedirectUri,
    String jwtSecret,
    boolean enableAutoVote
) {}
