package com.soundscapemap.api.model;

public record UserSession(String userId, String spotifyId, boolean anonymous) {}
