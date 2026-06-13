import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { Database } from './infra/db.js';
import { RedisBus } from './infra/redis.js';
import { SlidingWindowRateLimiter } from './infra/rateLimiter.js';
import { CircuitBreaker } from './infra/spotifyCircuitBreaker.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRegionRoutes } from './routes/regions.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerUserRoutes } from './routes/users.js';
import { registerVoteRoutes } from './routes/votes.js';
import { registerWebSocket, WebSocketHub } from './ws/hub.js';
import { SpotifyPoller } from './workers/spotifyPoller.js';

const app = Fastify({ logger: true });
const db = new Database(config.databaseUrl);
const bus = new RedisBus(config.redisUrl);
const limiter = new SlidingWindowRateLimiter(bus.pub);
const spotifyCircuit = new CircuitBreaker();
const hub = new WebSocketHub(bus.sub);

await app.register(cors, {
  origin: config.nodeEnv === 'production' ? ['https://soundscapemap.com'] : [config.publicWebOrigin],
  credentials: true
});
await app.register(websocket);

hub.bindRedis();

registerAuthRoutes(app, db);
registerHealthRoutes(app, db, bus, spotifyCircuit);
registerRegionRoutes(app, db, limiter);
registerSearchRoutes(app, limiter);
registerUserRoutes(app, db);
registerVoteRoutes(app, db, bus, limiter);
registerWebSocket(app, hub);

const spotifyPoller = new SpotifyPoller(spotifyCircuit, async (vote) => {
  await db.insertVote({ ...vote, source: 'listening', weight: 0.6 });
  const snapshot = await db.computeSnapshot(vote.h3_cell);
  await bus.publishRegionUpdate(snapshot);
});

if (config.enableAutoVote) spotifyPoller.start();

await app.listen({ port: config.port, host: '0.0.0.0' });
