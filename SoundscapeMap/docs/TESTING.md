# Testing Strategy

## Unit Tests

Implemented locally:

- Genre classification
- Vote weight decay
- Region score aggregation
- Dominant genre selection
- H3/track/vote payload validation

Planned after dependency install:

- JWT generation and validation
- Redis sliding window limiter
- Spotify circuit breaker
- Feature vector normalization
- Cluster quality metrics
- Transition-zone entropy detection
- Cluster-to-GeoJSON topology

## Integration Tests

The next integration gate is:

1. Start PostgreSQL and Redis with Docker Compose.
2. Run migration `infra/db/migrations/001_init.sql`.
3. Connect a WebSocket client subscribed to a seed H3 cell.
4. Submit `POST /api/votes`.
5. Assert DB row, region snapshot, and WebSocket `region_update`.

## End-to-End Tests

Use Playwright for:

- Vote submission from map interaction.
- Region color change after vote.
- Rate-limit rejection on repeated votes.
- Mobile bottom-sheet voting flow.
- Spotify OAuth with a test account.

## Load Tests

Run:

```bash
k6 run loadtests/vote-load.js
```

Launch target: p99 vote latency below 200ms, failure rate below 0.1 percent at 500 VUs.
