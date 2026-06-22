package com.soundscapemap.api.service;

import com.soundscapemap.api.model.CornellRegion;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class CornellRegionService {
  private final List<CornellRegion> regions = List.of(
      region("building:uris-library", "building", "Uris Library", "Arts Quad", 42.44764, -76.48477, 38,
          List.of(p(-76.48518, 42.44788), p(-76.4844, 42.44786), p(-76.48439, 42.44738), p(-76.4852, 42.4474), p(-76.48518, 42.44788))),
      region("building:olin-library", "building", "Olin Library", "Research stacks", 42.44726, -76.48412, 44,
          List.of(p(-76.48452, 42.44754), p(-76.48373, 42.44754), p(-76.48373, 42.44697), p(-76.48452, 42.44698), p(-76.48452, 42.44754))),
      region("building:statler-hall", "building", "Statler Hall", "Hotel school edge", 42.44644, -76.48221, 36,
          List.of(p(-76.48276, 42.44678), p(-76.48173, 42.44678), p(-76.48173, 42.44611), p(-76.48276, 42.44611), p(-76.48276, 42.44678))),
      region("building:duffield-hall", "building", "Duffield Hall", "Engineering atrium", 42.44496, -76.4822, 34,
          List.of(p(-76.48269, 42.44524), p(-76.48175, 42.44525), p(-76.48173, 42.4447), p(-76.48269, 42.44468), p(-76.48269, 42.44524))),
      region("building:gates-hall", "building", "Gates Hall", "Computing and information", 42.44405, -76.48133, 32,
          List.of(p(-76.48179, 42.44431), p(-76.48092, 42.44432), p(-76.48091, 42.44379), p(-76.48178, 42.44378), p(-76.48179, 42.44431))),
      region("place:arts-quad", "place", "Arts Quad", "Open campus commons", 42.44814, -76.48568, 8,
          List.of(p(-76.48733, 42.44882), p(-76.48426, 42.4488), p(-76.48425, 42.44748), p(-76.48731, 42.44748), p(-76.48733, 42.44882)))
  );

  public List<CornellRegion> all() {
    return regions;
  }

  public Optional<CornellRegion> byId(String regionId) {
    return regions.stream().filter(region -> region.regionId().equals(regionId)).findFirst();
  }

  private CornellRegion region(String id, String type, String name, String subtitle, double lat, double lng, double height, List<double[]> footprint) {
    return new CornellRegion(id, type, name, subtitle, new CornellRegion.Position(lat, lng, height), footprint);
  }

  private double[] p(double lng, double lat) {
    return new double[] {lng, lat};
  }
}
