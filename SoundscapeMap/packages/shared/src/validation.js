import { isMacroGenre } from './genres.js';

const H3_CELL_PATTERN = /^[0-9a-f]{15}$/i;
const SPOTIFY_TRACK_PATTERN = /^spotify:track:[A-Za-z0-9]{22}$/;

export function isValidH3Cell(cell) {
  return typeof cell === 'string' && H3_CELL_PATTERN.test(cell);
}

export function isValidTrackId(trackId) {
  return typeof trackId === 'string' && SPOTIFY_TRACK_PATTERN.test(trackId);
}

export function validateVotePayload(payload) {
  const errors = [];
  if (!isValidH3Cell(payload?.h3_cell)) errors.push({ field: 'h3_cell', code: 'INVALID_H3_CELL' });
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
