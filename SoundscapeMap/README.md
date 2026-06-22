# SoundscapeMap

SoundscapeMap is a real-time, community-driven musical map. Users vote for the track or genre that represents a physical place, optional Spotify listening data contributes ambient signals, and regions update live as a living musical landscape.

This repository is structured as a deployable monorepo:

- `apps/web` - React 18 + TypeScript + Vite + Google Maps/deck.gl client
- `services/api-spring` - Spring Boot API, auth, votes, WebSocket hub, Spotify poller
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
POSTGRES_IMAGE=postgres:16-alpine POSTGRES_PORT=55432 docker compose up -d postgres redis
```

Then run the API with the matching local database URL:

```bash
DATABASE_URL=postgresql://soundscape:soundscape@localhost:55432/soundscape \
API_PORT=8080 \
npm run dev:api
```

The default map view is centered on Cornell University and uses Google Maps with deck.gl overlays.

Run the dependency-free smoke tests that verify the core domain logic:

```bash
npm test
```

## Environment

Copy `.env.example` to `.env` and fill:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `JWT_SECRET`
- `DATABASE_URL`
- `MAPTILER_API_KEY`

Without Spotify credentials, anonymous voting and map viewing still work in local mode.

The API is now Spring Boot and runs through the repo-local Maven wrapper:

```bash
DATABASE_URL=postgresql://soundscape:soundscape@localhost:55432/soundscape \
PUBLIC_WEB_ORIGIN=http://127.0.0.1:5173 \
API_PORT=18080 \
./mvnw -f services/api-spring/pom.xml spring-boot:run
```

For Spotify login, create a Spotify Developer app and add this exact redirect URI:

```text
http://localhost:5173/callback
```

Then set at least:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_REDIRECT_URI=http://localhost:5173/callback
```

If your Spotify app is configured as a confidential/server-side app, also set `SPOTIFY_CLIENT_SECRET`. Restart the API after editing `.env`.

## Launch Checklist

- Run migration `infra/db/migrations/001_init.sql`.
- Confirm Spotify redirect URI is configured for `/callback`.
- Set CORS origins to production domains.
- Enable `REGION_MODEL=hdbscan` only after cluster quality metrics are stable.
- Run `loadtests/vote-load.js` against staging and confirm p99 latency.
- Import the Grafana dashboard and wire Prometheus/Loki alerts.
