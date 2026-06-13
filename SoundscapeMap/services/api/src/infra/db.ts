import pg from 'pg';
import { computeRegionScores, dominantGenre } from '@soundscapemap/shared';
import type { RegionSnapshot, VoteInput } from '../types.js';

const { Pool } = pg;

interface VoteRow {
  genre: string;
  track_id: string;
  weight: number;
  source: 'vote' | 'listening';
  voted_at: Date;
}

export class Database {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async health() {
    const started = Date.now();
    await this.pool.query('SELECT 1');
    return { ok: true, latency_ms: Date.now() - started };
  }

  async upsertAnonymousUser(deviceHash: string) {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO users (device_hash)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [deviceHash]
    );
    if (result.rows[0]) return result.rows[0].id;
    const existing = await this.pool.query<{ id: string }>('SELECT id FROM users WHERE device_hash = $1 LIMIT 1', [deviceHash]);
    return existing.rows[0]?.id;
  }

  async insertVote(vote: VoteInput) {
    await this.pool.query(
      `INSERT INTO votes (user_id, h3_cell, track_id, genre, weight, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [vote.userId, vote.h3_cell, vote.track_id, vote.genre, vote.weight ?? 1, vote.source]
    );
  }

  async votesForCell(h3Cell: string): Promise<VoteRow[]> {
    const result = await this.pool.query(
      `SELECT genre, track_id, weight, source, voted_at
       FROM votes
       WHERE h3_cell = $1 AND voted_at > NOW() - INTERVAL '2 hours'
       ORDER BY voted_at DESC`,
      [h3Cell]
    );
    return result.rows;
  }

  async computeSnapshot(h3Cell: string): Promise<RegionSnapshot> {
    const votes = await this.votesForCell(h3Cell);
    const scores = computeRegionScores(votes);
    const topTracks: Array<{ track_id: string; count: number }> = Object.entries(
      votes.reduce<Record<string, number>>((acc: Record<string, number>, vote: VoteRow) => {
        acc[vote.track_id] = (acc[vote.track_id] ?? 0) + 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([track_id, count]) => ({ track_id, count: Number(count) }));

    const snapshot = {
      h3_cell: h3Cell,
      dominant_genre: dominantGenre(scores, 'pop'),
      genre_scores: scores,
      vote_count: votes.length,
      top_tracks: topTracks,
      computed_at: new Date().toISOString()
    };

    await this.pool.query(
      `INSERT INTO region_snapshots (h3_cell, dominant_genre, genre_scores, vote_count, top_tracks)
       VALUES ($1, $2, $3, $4, $5)`,
      [snapshot.h3_cell, snapshot.dominant_genre, snapshot.genre_scores, snapshot.vote_count, JSON.stringify(snapshot.top_tracks)]
    );

    return snapshot;
  }

  async deleteUserData(userId: string) {
    await this.pool.query('UPDATE votes SET user_id = NULL WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
}
