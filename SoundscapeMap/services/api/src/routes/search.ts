import type { FastifyInstance } from 'fastify';
import { sanitizeText } from '@soundscapemap/shared';
import type { SlidingWindowRateLimiter } from '../infra/rateLimiter.js';

const seedTracks = [
  { id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', name: 'Chicago Pulse', artist: 'Local Signal', genre: 'electronic', album_art: null },
  { id: 'spotify:track:7ouMYWpwJ422jRcDASZB7P', name: 'Blue Hour Walk', artist: 'Lakefront Trio', genre: 'jazz', album_art: null },
  { id: 'spotify:track:2takcwOaAZWiXQijPHIx7B', name: 'Transit Anthem', artist: 'South Loop', genre: 'hiphop', album_art: null }
];

export function registerSearchRoutes(app: FastifyInstance, limiter: SlidingWindowRateLimiter) {
  app.get('/api/search/tracks', async (request, reply) => {
    const allowed = await limiter.allow(`search:${request.ip}`, 30, 60);
    if (!allowed.ok) {
      return reply.code(429).send({ error: { code: 'SEARCH_RATE_LIMITED', message: 'Too many search requests.', retry_after: allowed.retry_after } });
    }
    const query = sanitizeText((request.query as { q?: string }).q ?? '').toLowerCase();
    return {
      tracks: seedTracks.filter((track) => `${track.name} ${track.artist} ${track.genre}`.toLowerCase().includes(query)).slice(0, 10)
    };
  });
}
