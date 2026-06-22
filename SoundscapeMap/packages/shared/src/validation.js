import { isMacroGenre } from './genres.js';

const H3_CELL_PATTERN = /^[0-9a-f]{15}$/i;
const REGION_ID_PATTERN = /^(building|place):[a-z0-9][a-z0-9-]{1,80}$/;
const SPOTIFY_TRACK_PATTERN = /^spotify:track:[A-Za-z0-9]{22}$/;

export function isValidH3Cell(cell) {
  return typeof cell === 'string' && H3_CELL_PATTERN.test(cell);
}

export function isValidRegionId(regionId) {
  return typeof regionId === 'string' && REGION_ID_PATTERN.test(regionId);
}

export function normalizeRegionPayload(payload) {
  if (isValidRegionId(payload?.region_id)) {
    const regionType = String(payload.region_id).startsWith('place:') ? 'place' : 'building';
    return { region_id: payload.region_id, region_type: regionType, h3_cell: payload.h3_cell ?? payload.region_id };
  }
  if (isValidH3Cell(payload?.h3_cell)) {
    return { region_id: payload.h3_cell, region_type: 'h3', h3_cell: payload.h3_cell };
  }
  return undefined;
}

export function isValidTrackId(trackId) {
  return typeof trackId === 'string' && SPOTIFY_TRACK_PATTERN.test(trackId);
}

export function validateVotePayload(payload) {
  const errors = [];
  if (!normalizeRegionPayload(payload)) errors.push({ field: 'region_id', code: 'INVALID_REGION' });
  if (!isValidTrackId(payload?.track_id)) errors.push({ field: 'track_id', code: 'INVALID_TRACK_ID' });
  if (!isMacroGenre(payload?.genre)) errors.push({ field: 'genre', code: 'INVALID_GENRE' });
  return { ok: errors.length === 0, errors };
}

export function sanitizeText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
