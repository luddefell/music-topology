package com.soundscapemap.api.controller;

import com.soundscapemap.api.service.MlRegionService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ml")
public class MlRegionController {
  private final MlRegionService ml;

  public MlRegionController(MlRegionService ml) {
    this.ml = ml;
  }

  @GetMapping("/regions")
  public Map<String, Object> learnedRegions() {
    return Map.of(
        "regions", ml.latestLearnedRegions(),
        "run", ml.latestRun(),
        "hyperparameters", ml.hyperparameters()
    );
  }

  @PostMapping("/regions/rebuild")
  public ResponseEntity<?> rebuild() {
    return ResponseEntity.ok(ml.rebuildLearnedRegions());
  }
}
