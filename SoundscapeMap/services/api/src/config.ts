export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 8080),
  publicWebOrigin: process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://soundscape:soundscape@localhost:5432/soundscape',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:5173/callback',
  jwtSecret: process.env.JWT_SECRET ?? 'local-development-secret-change-me',
  maxCellsPerSubscription: Number(process.env.MAX_CELLS_PER_SUBSCRIPTION ?? 50),
  enableAutoVote: process.env.ENABLE_AUTO_VOTE !== 'false'
};
