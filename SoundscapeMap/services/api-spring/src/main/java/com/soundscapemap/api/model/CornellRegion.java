package com.soundscapemap.api.model;

import java.util.List;

public record CornellRegion(
    String regionId,
    String regionType,
    String name,
    String subtitle,
    Position position,
    List<double[]> footprint
) {
  public record Position(double latitude, double longitude, double height) {}
}
