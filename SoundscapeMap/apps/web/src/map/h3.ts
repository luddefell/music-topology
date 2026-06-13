import { cellToBoundary, gridDisk, latLngToCell } from 'h3-js';
import { getGenreColor } from '@soundscapemap/shared';
import type { RegionSnapshot } from '../state/useAppStore';

export const DEFAULT_CENTER: [number, number] = [-87.6298, 41.8781];
export const DEFAULT_CELL = latLngToCell(41.8781, -87.6298, 7);

export function cellsAround(lat: number, lng: number, radius = 2) {
  return gridDisk(latLngToCell(lat, lng, 7), radius);
}

export function cellToFeature(snapshot: RegionSnapshot, colorblind = false) {
  const boundary = cellToBoundary(snapshot.h3_cell, true);
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [boundary] },
    properties: {
      h3_cell: snapshot.h3_cell,
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
    h3_cell: cell,
    dominant_genre: 'pop',
    genre_scores: {},
    vote_count: 0,
    top_tracks: []
  };
}
