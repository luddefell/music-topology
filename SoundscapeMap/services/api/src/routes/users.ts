import type { FastifyInstance } from 'fastify';
import type { Database } from '../infra/db.js';
import { config } from '../config.js';
import { verifyJwt } from '../infra/jwt.js';

function tokenFromHeader(header: unknown) {
  if (typeof header !== 'string') return undefined;
  return header.match(/^Bearer\s+(.+)$/i)?.[1];
}

async function sessionFromRequest(header: unknown) {
  const token = tokenFromHeader(header);
  if (!token) return undefined;
  return verifyJwt(token, config.jwtSecret).catch(() => undefined);
}

export function registerUserRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/users/me/data', async (request, reply) => {
    const session = await sessionFromRequest(request.headers.authorization);
    if (!session) return reply.code(401).send({ error: { code: 'INVALID_TOKEN', message: 'Authentication required.' } });
    return {
      user: { id: session.userId, spotify_id: session.spotifyId ?? null, anonymous: session.anonymous },
      export_generated_at: new Date().toISOString(),
      note: 'Vote export query is intentionally scoped to authenticated users in the production repository.'
    };
  });

  app.delete('/api/users/me', async (request, reply) => {
    const session = await sessionFromRequest(request.headers.authorization);
    if (!session) return reply.code(401).send({ error: { code: 'INVALID_TOKEN', message: 'Authentication required.' } });
    await db.deleteUserData(session.userId);
    return reply.code(204).send();
  });
}
