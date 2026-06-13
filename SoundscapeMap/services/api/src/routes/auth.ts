import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { z } from 'zod';
import { config } from '../config.js';
import type { Database } from '../infra/db.js';
import { issueJwt } from '../infra/jwt.js';

const callbackSchema = z.object({
  code: z.string(),
  code_verifier: z.string().min(43)
});

export function createCodeVerifier() {
  return randomBytes(96).toString('base64url');
}

export function createCodeChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function registerAuthRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/auth/spotify/start', async () => {
    const codeVerifier = createCodeVerifier();
    const params = new URLSearchParams({
      client_id: config.spotifyClientId,
      response_type: 'code',
      redirect_uri: config.spotifyRedirectUri,
      code_challenge_method: 'S256',
      code_challenge: createCodeChallenge(codeVerifier),
      scope: 'user-read-playback-state user-read-recently-played'
    });
    return {
      authorize_url: `https://accounts.spotify.com/authorize?${params.toString()}`,
      code_verifier: codeVerifier
    };
  });

  app.post('/api/auth/spotify/callback', async (requestMessage, reply) => {
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      return reply.code(503).send({ error: { code: 'SPOTIFY_NOT_CONFIGURED', message: 'Spotify credentials are not configured.' } });
    }

    const body = callbackSchema.safeParse(requestMessage.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'INVALID_AUTH_CALLBACK', message: 'Invalid Spotify callback payload.' } });
    }

    const tokenResponse = await request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: body.data.code,
        redirect_uri: config.spotifyRedirectUri,
        client_id: config.spotifyClientId,
        client_secret: config.spotifyClientSecret,
        code_verifier: body.data.code_verifier
      }).toString()
    });

    if (tokenResponse.statusCode >= 400) {
      return reply.code(tokenResponse.statusCode).send({ error: { code: 'SPOTIFY_TOKEN_EXCHANGE_FAILED', message: 'Spotify token exchange failed.' } });
    }

    const token = await tokenResponse.body.json() as { access_token: string; refresh_token?: string };
    const profile = await request('https://api.spotify.com/v1/me', {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    const profileJson = await profile.body.json() as { id: string };
    const jwt = await issueJwt({ userId: profileJson.id, spotifyId: profileJson.id, anonymous: false }, config.jwtSecret);
    return { jwt, expires_in: 3600 };
  });

  app.post('/api/auth/anonymous', async () => {
    const deviceHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const userId = await db.upsertAnonymousUser(deviceHash);
    const jwt = await issueJwt({ userId, anonymous: true }, config.jwtSecret);
    return { jwt, expires_in: 3600 };
  });
}
