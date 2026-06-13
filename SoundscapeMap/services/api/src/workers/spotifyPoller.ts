import { request } from 'undici';
import { classifyGenre } from '@soundscapemap/shared';
import type { CircuitBreaker } from '../infra/spotifyCircuitBreaker.js';

interface ConnectedListener {
  userId: string;
  accessToken: string;
  h3Cell: string;
  lastPolledAt?: number;
}

export class SpotifyPoller {
  private listeners = new Map<string, ConnectedListener>();
  private interval?: NodeJS.Timeout;

  constructor(
    private circuit: CircuitBreaker,
    private onListeningVote: (vote: { userId: string; h3_cell: string; track_id: string; genre: string }) => Promise<void>
  ) {}

  add(listener: ConnectedListener) {
    this.listeners.set(listener.userId, listener);
  }

  remove(userId: string) {
    this.listeners.delete(userId);
  }

  start() {
    this.interval = setInterval(() => void this.tick(), 5000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private async tick() {
    const now = Date.now();
    for (const listener of this.listeners.values()) {
      if (listener.lastPolledAt && now - listener.lastPolledAt < 30000) continue;
      listener.lastPolledAt = now;
      if (!this.circuit.canRequest()) continue;
      try {
        const response = await request('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { authorization: `Bearer ${listener.accessToken}` }
        });
        if (response.statusCode === 204) {
          this.circuit.recordSuccess();
          continue;
        }
        if (response.statusCode === 429 || response.statusCode >= 500) {
          this.circuit.recordFailure();
          continue;
        }
        if (response.statusCode >= 400) {
          this.circuit.recordFailure();
          continue;
        }
        const json = await response.body.json() as {
          item?: { uri?: string; artists?: Array<{ genres?: string[] }> };
        };
        const trackId = json.item?.uri;
        if (!trackId) continue;
        const genres = json.item?.artists?.flatMap((artist) => artist.genres ?? []) ?? [];
        await this.onListeningVote({
          userId: listener.userId,
          h3_cell: listener.h3Cell,
          track_id: trackId,
          genre: classifyGenre(genres)
        });
        this.circuit.recordSuccess();
      } catch {
        this.circuit.recordFailure();
      }
    }
  }
}
