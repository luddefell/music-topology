import { cellToBoundary, gridDisk, latLngToCell } from 'h3-js';
import { getGenreColor } from '@soundscapemap/shared';
import type { RegionSnapshot } from '../state/useAppStore';

export const DEFAULT_CENTER: [number, number] = [-76.485, 42.4476];
export const DEFAULT_CELL = latLngToCell(42.4476, -76.485, 7);
export const DEFAULT_PLACE_LABEL = 'Cornell University';

export function cellsAround(lat: number, lng: number, radius = 2) {
  return gridDisk(latLngToCell(lat, lng, 7), radius);
}

export function cellToFeature(snapshot: RegionSnapshot, colorblind = false) {
  const cell = snapshot.h3_cell ?? snapshot.region_id;
  const boundary = cellToBoundary(cell, true);
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [boundary] },
    properties: {
      h3_cell: cell,
      dominant_genre: snapshot.dominant_genre,
      genre_color: getGenreColor(snapshot.dominant_genre, colorblind),
      vote_count: snapshot.vote_count,
      opacity: Math.min(0.3 + snapshot.vote_count * 0.05, 0.85),
      just_updated: false
    }
  };
}

export function emptySnapshot(cell: string): RegionSnapshot {
  return {
    region_id: cell,
    region_type: 'h3',
    h3_cell: cell,
    dominant_genre: 'unknown',
    genre_scores: {},
    vote_count: 0,
    top_tracks: []
  };
}
