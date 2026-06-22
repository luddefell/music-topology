import { create } from 'zustand';

export interface RegionSnapshot {
  region_id: string;
  region_type: string;
  h3_cell?: string;
  name?: string;
  subtitle?: string;
  dominant_genre: string;
  genre_scores: Record<string, number>;
  vote_count: number;
  unique_user_count?: number;
  top_tracks?: Array<{ track_id: string; count: number; name?: string; artist?: string; album_art?: string | null; genre_label?: string }>;
  computed_at?: string;
}

interface AppState {
  jwt?: string;
  selectedRegionId?: string;
  snapshots: Record<string, RegionSnapshot>;
  spotifyConnected: boolean;
  spotifyStatus?: string;
  autoVote: boolean;
  colorblindPalette: boolean;
  setJwt: (jwt: string) => void;
  selectRegion: (regionId: string) => void;
  mergeSnapshot: (snapshot: RegionSnapshot) => void;
  setSpotifyConnected: (connected: boolean) => void;
  setSpotifyStatus: (status?: string) => void;
  setAutoVote: (enabled: boolean) => void;
  setColorblindPalette: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  snapshots: {},
  spotifyConnected: false,
  autoVote: false,
  colorblindPalette: false,
  setJwt: (jwt) => set({ jwt }),
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  mergeSnapshot: (snapshot) => set((state) => ({ snapshots: { ...state.snapshots, [snapshot.region_id ?? snapshot.h3_cell ?? 'unknown']: snapshot } })),
  setSpotifyConnected: (spotifyConnected) => set({ spotifyConnected }),
  setSpotifyStatus: (spotifyStatus) => set({ spotifyStatus }),
  setAutoVote: (autoVote) => set({ autoVote }),
  setColorblindPalette: (colorblindPalette) => set({ colorblindPalette })
}));
