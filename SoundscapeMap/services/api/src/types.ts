export type VoteSource = 'vote' | 'listening';

export interface UserSession {
  userId: string;
  spotifyId?: string;
  anonymous: boolean;
}

export interface VoteInput {
  userId: string;
  h3_cell: string;
  track_id: string;
  genre: string;
  weight?: number;
  source: VoteSource;
}

export interface RegionSnapshot {
  h3_cell: string;
  dominant_genre: string;
  genre_scores: Record<string, number>;
  vote_count: number;
  top_tracks: Array<{ track_id: string; count: number }>;
  computed_at: string;
}

export interface RegionFeature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, unknown>;
}
