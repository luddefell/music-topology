import type { FastifyInstance } from 'fastify';
import { validateVotePayload } from '@soundscapemap/shared';
import type { Database } from '../infra/db.js';
import type { RedisBus } from '../infra/redis.js';
import type { SlidingWindowRateLimiter } from '../infra/rateLimiter.js';
import { config } from '../config.js';
import { verifyJwt } from '../infra/jwt.js';

function bearerToken(header: unknown) {
  if (typeof header !== 'string') return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function registerVoteRoutes(app: FastifyInstance, db: Database, bus: RedisBus, limiter: SlidingWindowRateLimiter) {
  app.post('/api/votes', async (request, reply) => {
    const validation = validateVotePayload(request.body);
    if (!validation.ok) {
      return reply.code(400).send({ error: { code: 'INVALID_VOTE', message: 'Vote payload is invalid.', details: validation.errors } });
    }

    const token = bearerToken(request.headers.authorization);
    let session = token
      ? await verifyJwt(token, config.jwtSecret).catch(() => undefined)
      : undefined;

    if (!session) {
      const userId = await db.upsertAnonymousUser(`ip:${request.ip}`);
      session = { userId, anonymous: true };
    }

    const body = request.body as { h3_cell: string; track_id: string; genre: string };
    const limit = await limiter.allow(`vote:${session.userId}:${body.h3_cell}`, 1, 1800);
    if (!limit.ok) {
      return reply.code(429).send({
        error: {
          code: 'VOTE_RATE_LIMITED',
          message: "You've voted recently here. Come back soon.",
          retry_after: limit.retry_after
        }
      });
    }

    await db.insertVote({
      userId: session.userId,
      h3_cell: body.h3_cell,
      track_id: body.track_id,
      genre: body.genre,
      source: 'vote',
      weight: 1
    });
    const snapshot = await db.computeSnapshot(body.h3_cell);
    await bus.publishRegionUpdate(snapshot);
    return { ok: true, region_snapshot: snapshot };
  });
}
