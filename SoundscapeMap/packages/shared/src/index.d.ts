export interface MacroGenreDefinition {
  id: string;
  label: string;
  color: string;
  colorblindColor: string;
  icon: string;
}

export const MACRO_GENRES: MacroGenreDefinition[];
export const GENRE_IDS: string[];
export const GENRE_BY_ID: Record<string, MacroGenreDefinition>;
export const HALF_LIFE_MINUTES: number;
export const LIVE_WINDOW_MINUTES: number;

export interface CornellRegion {
  region_id: string;
  region_type: 'building' | 'place';
  name: string;
  subtitle: string;
  position: { latitude: number; longitude: number; height: number };
  footprint: Array<[number, number]>;
}

export const CORNELL_REGIONS: CornellRegion[];
export function regionById(regionId: string): CornellRegion | undefined;

export function isMacroGenre(value: unknown): boolean;
export function classifyGenre(spotifyGenres?: string[]): string;
export function getGenreColor(genre: string, colorblind?: boolean): string;
export function sortedGenreScores(scores: Record<string, number>): Array<[string, number]>;
export function computeWeight(votedAt: Date | string, now?: Date): number;
export function computeRegionScores(votes: Array<{ genre: string; voted_at?: Date | string; votedAt?: Date | string; weight?: number; source?: string }>, now?: Date): Record<string, number>;
export function dominantGenre(scores: Record<string, number>, fallback?: string): string;
export function voteIsLive(votedAt: Date | string, now?: Date): boolean;
export function isValidH3Cell(cell: unknown): boolean;
export function isValidRegionId(regionId: unknown): boolean;
export function normalizeRegionPayload(payload: unknown): { region_id: string; region_type: string; h3_cell: string } | undefined;
export function isValidTrackId(trackId: unknown): boolean;
export function validateVotePayload(payload: unknown): { ok: boolean; errors: Array<{ field: string; code: string }> };
export function sanitizeText(value: unknown, maxLength?: number): string;
