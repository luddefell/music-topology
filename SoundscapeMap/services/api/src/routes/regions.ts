import type { FastifyInstance } from 'fastify';
import { getGenreColor, isValidH3Cell } from '@soundscapemap/shared';
import type { Database } from '../infra/db.js';
import type { SlidingWindowRateLimiter } from '../infra/rateLimiter.js';

function fixedCellFeature(cell: string, snapshot: Awaited<ReturnType<Database['computeSnapshot']>>) {
  return {
    type: 'Feature',
    geometry: null,
    properties: {
      h3_cell: cell,
      dominant_genre: snapshot.dominant_genre,
      genre_color: getGenreColor(snapshot.dominant_genre),
      vote_count: snapshot.vote_count,
      opacity: Math.min(0.3 + snapshot.vote_count * 0.05, 0.85)
    }
  };
}

export function registerRegionRoutes(app: FastifyInstance, db: Database, limiter: SlidingWindowRateLimiter) {
  app.get('/api/regions', async (request, reply) => {
    const allowed = await limiter.allow(`regions:${request.ip}`, 100, 60);
    if (!allowed.ok) {
      return reply.code(429).send({ error: { code: 'REGION_RATE_LIMITED', message: 'Too many region requests.', retry_after: allowed.retry_after } });
    }
    const query = request.query as { cells?: string };
    const cells = (query.cells ?? '').split(',').filter(Boolean).slice(0, 500);
    if (cells.some((cell) => !isValidH3Cell(cell))) {
      return reply.code(400).send({ error: { code: 'INVALID_CELLS', message: 'One or more H3 cells are invalid.' } });
    }
    const snapshots = await Promise.all(cells.map((cell) => db.computeSnapshot(cell)));
    return { type: 'FeatureCollection', features: snapshots.map((snapshot) => fixedCellFeature(snapshot.h3_cell, snapshot)) };
  });

  app.get('/api/regions/:h3_cell', async (request, reply) => {
    const allowed = await limiter.allow(`region:${request.ip}`, 100, 60);
    if (!allowed.ok) {
      return reply.code(429).send({ error: { code: 'REGION_RATE_LIMITED', message: 'Too many region requests.', retry_after: allowed.retry_after } });
    }
    const { h3_cell } = request.params as { h3_cell: string };
    if (!isValidH3Cell(h3_cell)) {
      return reply.code(400).send({ error: { code: 'INVALID_H3_CELL', message: 'H3 cell is invalid.' } });
    }
    return db.computeSnapshot(h3_cell);
  });
}
