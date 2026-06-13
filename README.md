# SoundscapeMap

SoundscapeMap is a real-time, community-driven musical map. Users vote for the track or genre that represents a physical place, optional Spotify listening data contributes ambient signals, and regions update live as a living musical landscape.

This repository is structured as a deployable monorepo:

- `apps/web` - React 18 + TypeScript + Vite + MapLibre client
- `services/api` - Node 20 + Fastify API, auth, votes, WebSocket hub, Spotify poller
- `services/region` - Python 3.12 + FastAPI region aggregation and clustering pipeline
- `packages/shared` - shared taxonomy, scoring, validation, and protocol helpers
- `infra` - database migrations, Caddy gateway, Docker Compose
- `monitoring` - Prometheus and Grafana starter assets
- `loadtests` - k6 vote-ingestion load test

## Phase 0 Decisions

The prompt requested several launch decisions before implementation. These defaults are documented in [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md):

- Map provider: MapTiler free tier for launch, with OpenMapTiles as the scale fallback.
- Spotify app: environment-driven OAuth credentials; app runs in anonymous mode without them.
- Initial city: Chicago, centered on downtown for local seeded examples.
- Hosting: Render hobby tier first, ECS Fargate later.
- Team/timeline: 1-2 developers over 8-12 weeks.
- Region model: `fixed_h3` locally until enough live cells exist; `hdbscan` is the production target.
- Cluster recompute interval: 300 seconds.

## Local Development

Install dependencies after filling any desired secrets in `.env`:

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173`, the API on `http://localhost:8080`, and the region service on `http://localhost:8090`.

For backing services:

```bash
docker compose up postgres redis caddy
```

Run the dependency-free smoke tests that verify the core domain logic:

```bash
npm test
```

## Environment

Copy `.env.example` to `.env` and fill:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `JWT_SECRET`
- `REFRESH_TOKEN_ENCRYPTION_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `MAPTILER_API_KEY`

Without Spotify credentials, anonymous voting and map viewing still work in local mode.

## Launch Checklist

- Run migration `infra/db/migrations/001_init.sql`.
- Confirm Spotify redirect URI is configured for `/callback`.
- Set CORS origins to production domains.
- Enable `REGION_MODEL=hdbscan` only after cluster quality metrics are stable.
- Run `loadtests/vote-load.js` against staging and confirm p99 latency.
- Import the Grafana dashboard and wire Prometheus/Loki alerts.
