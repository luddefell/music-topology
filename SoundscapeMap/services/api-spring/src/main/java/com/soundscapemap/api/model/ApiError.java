package com.soundscapemap.api.model;

import java.util.Map;

public record ApiError(Map<String, Object> error) {
  public static ApiError of(String code, String message) {
    return new ApiError(Map.of("code", code, "message", message));
  }
}
