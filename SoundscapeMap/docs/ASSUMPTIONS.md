# Assumptions and Overrides

These choices satisfy Phase 0 and the executor clarification list in the prompt.

## Map Granularity

Votes are collected by H3 cell at resolution 7. Rendered production regions are not fixed political boundaries. They are discovered from clusters of musically similar H3 cells. Local development starts with fixed H3 rendering because it works without live density.

## Spotify Access

Spotify uses OAuth 2.0 PKCE. The API reads currently playing and recently played tracks only. It never streams audio. The app remains useful without credentials by accepting anonymous manual votes.

## Voting Model

One vote is accepted per user, region, and 30-minute window. Votes decay with a 45-minute half-life in scoring, and votes older than two hours are ignored for live region computation.

## Music Classification

Spotify artist genre strings are collapsed into the 12 macro-genres in `packages/shared/src/genres.js`.

## Anonymous Fallback

Anonymous users are identified by a salted device hash used only for deduplication and rate limiting. They cannot contribute Spotify listening data.

## Scale Target

The architecture targets 10,000 concurrent users, 500 active regions, and 50 votes per second. Local development uses one API instance, one region service, Redis, and PostgreSQL.

## Privacy

Precise GPS coordinates are converted to H3 cells in the client and are not persisted. Spotify refresh tokens are encrypted server-side; access tokens are memory-only.

## Executor Decisions

| Question | Decision |
|---|---|
| Map tile provider | MapTiler free tier for launch; self-host OpenMapTiles when tile volume or budget requires it. |
| Spotify Developer App | Use env vars. Anonymous mode works until the owner provides credentials. |
| Initial city | Chicago downtown seed area. |
| Hosting budget | Render hobby tier as the starter deployment; ECS Fargate for higher budget. |
| Team size | 1-2 developers over 8-12 weeks. |
| ML model preference | `fixed_h3` locally; `hdbscan` once there are at least 200 active cells in the launch city. |
| Cluster recompute interval | 300 seconds by default; can drop to 60 seconds for live events. |
