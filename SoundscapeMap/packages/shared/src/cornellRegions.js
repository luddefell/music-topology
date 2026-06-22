export const CORNELL_REGIONS = [
  {
    region_id: 'building:uris-library',
    region_type: 'building',
    name: 'Uris Library',
    subtitle: 'Arts Quad',
    position: { latitude: 42.44764, longitude: -76.48477, height: 38 },
    footprint: [
      [-76.48518, 42.44788],
      [-76.4844, 42.44786],
      [-76.48439, 42.44738],
      [-76.4852, 42.4474],
      [-76.48518, 42.44788]
    ]
  },
  {
    region_id: 'building:olin-library',
    region_type: 'building',
    name: 'Olin Library',
    subtitle: 'Research stacks',
    position: { latitude: 42.44726, longitude: -76.48412, height: 44 },
    footprint: [
      [-76.48452, 42.44754],
      [-76.48373, 42.44754],
      [-76.48373, 42.44697],
      [-76.48452, 42.44698],
      [-76.48452, 42.44754]
    ]
  },
  {
    region_id: 'building:statler-hall',
    region_type: 'building',
    name: 'Statler Hall',
    subtitle: 'Hotel school edge',
    position: { latitude: 42.44644, longitude: -76.48221, height: 36 },
    footprint: [
      [-76.48276, 42.44678],
      [-76.48173, 42.44678],
      [-76.48173, 42.44611],
      [-76.48276, 42.44611],
      [-76.48276, 42.44678]
    ]
  },
  {
    region_id: 'building:duffield-hall',
    region_type: 'building',
    name: 'Duffield Hall',
    subtitle: 'Engineering atrium',
    position: { latitude: 42.44496, longitude: -76.4822, height: 34 },
    footprint: [
      [-76.48269, 42.44524],
      [-76.48175, 42.44525],
      [-76.48173, 42.4447],
      [-76.48269, 42.44468],
      [-76.48269, 42.44524]
    ]
  },
  {
    region_id: 'building:gates-hall',
    region_type: 'building',
    name: 'Gates Hall',
    subtitle: 'Computing and information',
    position: { latitude: 42.44405, longitude: -76.48133, height: 32 },
    footprint: [
      [-76.48179, 42.44431],
      [-76.48092, 42.44432],
      [-76.48091, 42.44379],
      [-76.48178, 42.44378],
      [-76.48179, 42.44431]
    ]
  },
  {
    region_id: 'place:arts-quad',
    region_type: 'place',
    name: 'Arts Quad',
    subtitle: 'Open campus commons',
    position: { latitude: 42.44814, longitude: -76.48568, height: 8 },
    footprint: [
      [-76.48733, 42.44882],
      [-76.48426, 42.4488],
      [-76.48425, 42.44748],
      [-76.48731, 42.44748],
      [-76.48733, 42.44882]
    ]
  }
];

export function regionById(regionId) {
  return CORNELL_REGIONS.find((region) => region.region_id === regionId);
}
