# API Contract

## REST

### `POST /api/votes`

Body:

```json
{
  "region_id": "building:uris-library",
  "region_type": "building",
  "track_id": "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
  "track_name": "DID IT AGAIN",
  "artist": "Travy, Elzzz, Fred again..",
  "album_art": "https://...",
  "genre": "hiphop"
}
```

Response:

```json
{
  "ok": true,
  "region_snapshot": {
    "region_id": "building:uris-library",
    "region_type": "building",
    "name": "Uris Library",
    "dominant_genre": "hiphop",
    "genre_scores": { "hiphop": 1 },
    "vote_count": 1
  }
}
```

### `GET /api/regions?cells=...`

Returns a GeoJSON feature collection for up to 500 H3 cells.

### `GET /api/regions/demo/cornell`

Returns Cornell building/place fixtures with current snapshots for the Google 3D demo.

### `GET /api/regions/by-id/:region_id`

Returns the current snapshot and top recent tracks for one building/place region.

### `GET /api/regions/:h3_cell`

Returns the current snapshot and top recent tracks for one H3 cell.

### `GET /api/search/tracks?q=...`

Proxies Spotify search when credentials are present. Local fallback returns seed tracks.

### `POST /api/listening/start`

Starts Spotify auto-vote for the authenticated user and selected region.

```json
{ "region_id": "building:uris-library", "region_type": "building" }
```

### `POST /api/listening/stop`

Stops Spotify auto-vote for the authenticated user.

### Health

- `GET /health`
- `GET /health/db`
- `GET /health/redis`
- `GET /health/spotify`

## WebSocket

Client commands:

```json
{ "type": "subscribe", "cells": ["building:uris-library"] }
{ "type": "unsubscribe", "cells": ["building:uris-library"] }
{ "type": "pong" }
```

Server messages:

```json
{ "type": "region_update", "region_id": "building:uris-library", "snapshot": {} }
{ "type": "ping" }
{ "type": "error", "code": "INVALID_SUBSCRIPTION", "message": "Too many cells" }
```
