# Completion Audit

Current audit date: 2026-06-13.

This file compares the prompt requirements to the current repository state. It is deliberately strict: implemented scaffolding is not marked complete unless current evidence proves the behavior.

## Proven Complete Locally

- Phase 0 assumptions are documented in `docs/ASSUMPTIONS.md`.
- Phase 1 architecture is documented in `docs/ARCHITECTURE.md`.
- Phase 3.1 genre taxonomy exists in `packages/shared/src/genres.js`.
- Phase 3.3 vote decay and score aggregation exist in `packages/shared/src/weights.js`.
- Phase 3.2 and 3.5.8 database schema exists in `infra/db/migrations/001_init.sql`.
- Phase 3.4 REST/WebSocket contract is documented in `docs/API.md`.
- Phase 4.2 rate-limit primitives exist in `services/api-spring/src/main/java/com/soundscapemap/api/service/RateLimiterService.java` and are wired to vote, search, and region routes.
- Phase 4.3 vote payload validation exists in `packages/shared/src/validation.js`.
- Phase 7 WebSocket subscribe/unsubscribe/broadcast hub exists in `services/api-spring/src/main/java/com/soundscapemap/api/ws`.
- Phase 7 WebSocket broadcast has been integration-tested through Redis with a live API process.
- Phase 8 frontend map-first UI exists in `apps/web`.
- Phase 9.4 health routes exist in `services/api-spring/src/main/java/com/soundscapemap/api/controller/HealthController.java`.
- Phase 11 privacy and erasure/export route scaffolding exists in `services/api-spring/src/main/java/com/soundscapemap/api/controller/UserController.java` and `docs/PRIVACY.md`.
- Phase 12.2 CI scaffold exists in `.github/workflows/deploy.yml`.
- Phase 13.1 local unit tests exist in `packages/shared/test/domain.test.mjs`.
- Phase 13 integration coverage now includes `scripts/integration-vote-flow.mjs`.
- Phase 13.4 load-test scaffold exists in `loadtests/vote-load.js`.

## Verification Evidence

- `npm test` passes: 4 domain tests.
- `npm run smoke` passes.
- `npm run lint` passes across shared and web workspaces.
- `npm run build` passes across shared, Spring API, and web workspaces when Maven is on `PATH`.
- `python3 -m compileall services/region/app` passes.
- Browser check at `http://localhost:5173/` rendered `SoundscapeMap`, `Vote`, a visible region panel, and a MapLibre container without a Vite error overlay.
- Docker Compose successfully ran isolated Redis and plain PostgreSQL on port `55432`; migration created `users`, `votes`, `region_snapshots`, `spotify_cache`, `region_clusters`, and `cluster_quality_log`.
- `npm run integration:vote` passed against live API/PostgreSQL/Redis, proving anonymous auth, vote persistence, region snapshot persistence, Redis publish, and WebSocket `region_update`.
- Region service dependencies installed in `.venv`; direct FastAPI route-function verification passed for `health` and `cluster`.
- Forced `REGION_MODEL=hdbscan` pipeline verification produced 2 clusters with silhouette `0.9993941897782215`, Davies-Bouldin `0.0008552615013285442`, and fit duration `1563ms`.
- 2026-06-18 stabilization: browser verification showed Cornell University, no `Reconnecting` banner, a MapLibre canvas, and no console errors.
- 2026-06-18 stabilization: `npm run integration:vote` passed again against fresh local Postgres/Redis/API after Redis timeout hardening.
- 2026-06-18 stabilization: Spotify button now starts the real `/api/auth/spotify/start` flow and reports missing `.env` credentials instead of pretending anonymous auth is Spotify.

## Implemented But Not Fully Proven

- Spotify OAuth PKCE routes exist, but no real Spotify developer credentials were available for end-to-end verification.
- Region service clustering endpoint exists with HDBSCAN/GMM/QDA/fixed fallback logic, and core route/pipeline behavior was verified in process. The service was not bound to a local port because port-bind approval was unavailable at that step.
- Docker Compose includes PostgreSQL, Redis, and Caddy. PostgreSQL and Redis were started and verified; Caddy was not started.
- Monitoring and alert assets exist, but Prometheus/Grafana were not started.
- CI/CD is a scaffold, not a real production deployment workflow with registry credentials and hosting targets.

## Not Complete Against Production Definition of Done

- Real Spotify OAuth flow with JWT issuance has not been exercised with a Spotify account.
- Real vote persistence, WebSocket broadcast, and region recompute are proven locally by `npm run integration:vote`; they are not yet proven under load or in CI.
- The ML pipeline has been exercised on synthetic H3-like vote vectors, but not benchmarked on real production H3 vote vectors, and silhouette/Davies-Bouldin metrics are not wired to Prometheus.
- k6 load test has not been run at 500 VUs.
- 100 concurrent WebSocket clients have not been tested.
- Lighthouse mobile performance has not been run.
- Production deployment, Grafana dashboard import, alert delivery, and database migration execution are not complete.

## Next Best Steps

1. Add Playwright E2E tests for map vote flow and rate-limit behavior.
2. Run k6 against the live API and collect 500 VU p99 latency evidence.
3. Run 100 concurrent WebSocket clients and record fan-out latency evidence.
4. Wire cluster quality metrics to Prometheus and run Grafana locally.
5. Exercise real Spotify OAuth with owner-provided credentials.
6. Replace CI/CD placeholders with real registry, staging, production, and alert delivery configuration.
