package com.soundscapemap.api.controller;

import com.soundscapemap.api.model.ApiError;
import com.soundscapemap.api.model.CornellRegion;
import com.soundscapemap.api.model.RegionSnapshot;
import com.soundscapemap.api.repository.SoundscapeRepository;
import com.soundscapemap.api.service.CornellRegionService;
import com.soundscapemap.api.service.RateLimiterService;
import com.soundscapemap.api.service.ValidationService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RegionController {
  private final SoundscapeRepository repository;
  private final CornellRegionService cornell;
  private final RateLimiterService limiter;
  private final ValidationService validation;

  public RegionController(SoundscapeRepository repository, CornellRegionService cornell, RateLimiterService limiter, ValidationService validation) {
    this.repository = repository;
    this.cornell = cornell;
    this.limiter = limiter;
    this.validation = validation;
  }

  @GetMapping("/api/regions/demo/cornell")
  public ResponseEntity<?> cornell(HttpServletRequest request) {
    RateLimiterService.Result allowed = limiter.allow("regions:cornell:" + request.getRemoteAddr(), 100, 60);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "REGION_RATE_LIMITED", "message", "Too many region requests.", "retry_after", allowed.retryAfter())));
    List<Map<String, Object>> regions = cornell.all().stream().map(region -> {
      RegionSnapshot snapshot = repository.computeSnapshot(region.regionId(), region.regionType());
      return Map.<String, Object>of(
          "regionId", region.regionId(),
          "regionType", region.regionType(),
          "name", region.name(),
          "subtitle", region.subtitle(),
          "position", region.position(),
          "footprint", region.footprint(),
          "snapshot", snapshot
      );
    }).toList();
    return ResponseEntity.ok(Map.of("regions", regions, "feature_collection", Map.of("type", "FeatureCollection", "features", List.of())));
  }

  @GetMapping("/api/regions")
  public ResponseEntity<?> regions(@RequestParam(name = "cells", defaultValue = "") String cells, HttpServletRequest request) {
    RateLimiterService.Result allowed = limiter.allow("regions:" + request.getRemoteAddr(), 100, 60);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "REGION_RATE_LIMITED", "message", "Too many region requests.", "retry_after", allowed.retryAfter())));
    List<String> cellList = cells.isBlank() ? List.of() : List.of(cells.split(",")).stream().filter(value -> !value.isBlank()).limit(500).toList();
    if (cellList.stream().anyMatch(cell -> !validation.isH3Cell(cell))) {
      return ResponseEntity.badRequest().body(ApiError.of("INVALID_CELLS", "One or more H3 cells are invalid."));
    }
    return ResponseEntity.ok(Map.of("type", "FeatureCollection", "features", List.of()));
  }

  @GetMapping("/api/regions/by-id/{regionId}")
  public ResponseEntity<?> byId(@PathVariable String regionId, HttpServletRequest request) {
    RateLimiterService.Result allowed = limiter.allow("region:" + request.getRemoteAddr(), 100, 60);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "REGION_RATE_LIMITED", "message", "Too many region requests.", "retry_after", allowed.retryAfter())));
    if (!validation.isRegionId(regionId)) return ResponseEntity.badRequest().body(ApiError.of("INVALID_REGION", "Region id is invalid."));
    CornellRegion region = cornell.byId(regionId).orElse(null);
    return ResponseEntity.ok(repository.computeSnapshot(regionId, region == null ? "building" : region.regionType()));
  }

  @GetMapping("/api/regions/{h3Cell}")
  public ResponseEntity<?> h3(@PathVariable String h3Cell, HttpServletRequest request) {
    RateLimiterService.Result allowed = limiter.allow("region:" + request.getRemoteAddr(), 100, 60);
    if (!allowed.ok()) return ResponseEntity.status(429).body(Map.of("error", Map.of("code", "REGION_RATE_LIMITED", "message", "Too many region requests.", "retry_after", allowed.retryAfter())));
    if (!validation.isH3Cell(h3Cell)) return ResponseEntity.badRequest().body(ApiError.of("INVALID_H3_CELL", "H3 cell is invalid."));
    return ResponseEntity.ok(repository.computeSnapshot(h3Cell, "h3"));
  }
}
