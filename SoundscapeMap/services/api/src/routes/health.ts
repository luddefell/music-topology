import type { FastifyInstance } from 'fastify';
import type { Database } from '../infra/db.js';
import type { RedisBus } from '../infra/redis.js';
import type { CircuitBreaker } from '../infra/spotifyCircuitBreaker.js';

export function registerHealthRoutes(app: FastifyInstance, db: Database, bus: RedisBus, spotifyCircuit: CircuitBreaker) {
  app.get('/health', async () => ({ ok: true, uptime: process.uptime() }));
  app.get('/health/db', async () => db.health());
  app.get('/health/redis', async () => bus.health());
  app.get('/health/spotify', async () => ({ ok: spotifyCircuit.canRequest(), circuit: spotifyCircuit.state() }));
}
