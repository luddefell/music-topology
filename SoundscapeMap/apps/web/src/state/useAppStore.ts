import { create } from 'zustand';

export interface RegionSnapshot {
  h3_cell: string;
  dominant_genre: string;
  genre_scores: Record<string, number>;
  vote_count: number;
  top_tracks?: Array<{ track_id: string; count: number }>;
  computed_at?: string;
}

interface AppState {
  jwt?: string;
  selectedCell?: string;
  snapshots: Record<string, RegionSnapshot>;
  spotifyConnected: boolean;
  autoVote: boolean;
  colorblindPalette: boolean;
  setJwt: (jwt: string) => void;
  selectCell: (cell: string) => void;
  mergeSnapshot: (snapshot: RegionSnapshot) => void;
  setSpotifyConnected: (connected: boolean) => void;
  setAutoVote: (enabled: boolean) => void;
  setColorblindPalette: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  snapshots: {},
  spotifyConnected: false,
  autoVote: false,
  colorblindPalette: false,
  setJwt: (jwt) => set({ jwt }),
  selectCell: (cell) => set({ selectedCell: cell }),
  mergeSnapshot: (snapshot) => set((state) => ({ snapshots: { ...state.snapshots, [snapshot.h3_cell]: snapshot } })),
  setSpotifyConnected: (spotifyConnected) => set({ spotifyConnected }),
  setAutoVote: (autoVote) => set({ autoVote }),
  setColorblindPalette: (colorblindPalette) => set({ colorblindPalette })
}));
