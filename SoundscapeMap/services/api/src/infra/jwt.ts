import { SignJWT, jwtVerify } from 'jose';
import type { UserSession } from '../types.js';

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function issueJwt(session: UserSession, secret: string) {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey(secret));
}

export async function verifyJwt(token: string, secret: string): Promise<UserSession> {
  const { payload } = await jwtVerify(token, secretKey(secret));
  return {
    userId: String(payload.userId),
    spotifyId: payload.spotifyId ? String(payload.spotifyId) : undefined,
    anonymous: Boolean(payload.anonymous)
  };
}
