package com.soundscapemap.api.service;

import com.soundscapemap.api.model.RegionTarget;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
public class ValidationService {
  private static final Pattern H3_CELL = Pattern.compile("^[0-9a-fA-F]{15}$");
  private static final Pattern REGION_ID = Pattern.compile("^(building|place):[a-z0-9][a-z0-9-]{1,80}$");
  private static final Pattern SPOTIFY_TRACK = Pattern.compile("^spotify:track:[A-Za-z0-9]{22}$");

  public boolean isH3Cell(String value) {
    return value != null && H3_CELL.matcher(value).matches();
  }

  public boolean isRegionId(String value) {
    return value != null && REGION_ID.matcher(value).matches();
  }

  public boolean isTrackId(String value) {
    return value != null && SPOTIFY_TRACK.matcher(value).matches();
  }

  public Optional<RegionTarget> normalize(Map<String, Object> payload) {
    Object regionValue = payload.get("region_id");
    if (regionValue instanceof String regionId && isRegionId(regionId)) {
      String regionType = regionId.startsWith("place:") ? "place" : "building";
      Object h3Value = payload.get("h3_cell");
      return Optional.of(new RegionTarget(regionId, regionType, h3Value instanceof String h3 ? h3 : regionId));
    }
    Object h3Value = payload.get("h3_cell");
    if (h3Value instanceof String h3 && isH3Cell(h3)) {
      return Optional.of(new RegionTarget(h3, "h3", h3));
    }
    return Optional.empty();
  }
}
