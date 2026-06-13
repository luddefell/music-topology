# API Contract

## REST

### `POST /api/votes`

Body:

```json
{
  "h3_cell": "872664c1effffff",
  "track_id": "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
  "genre": "hiphop"
}
```

Response:

```json
{
  "ok": true,
  "region_snapshot": {
    "h3_cell": "872664c1effffff",
    "dominant_genre": "hiphop",
    "genre_scores": { "hiphop": 1 },
    "vote_count": 1
  }
}
```

### `GET /api/regions?cells=...`

Returns a GeoJSON feature collection for up to 500 H3 cells.

### `GET /api/regions/:h3_cell`

Returns the current snapshot and top recent tracks for one H3 cell.

### `GET /api/search/tracks?q=...`

Proxies Spotify search when credentials are present. Local fallback returns seed tracks.

### Health

- `GET /health`
- `GET /health/db`
- `GET /health/redis`
- `GET /health/spotify`

## WebSocket

Client commands:

```json
{ "type": "subscribe", "cells": ["872664c1effffff"] }
{ "type": "unsubscribe", "cells": ["872664c1effffff"] }
{ "type": "pong" }
```

Server messages:

```json
{ "type": "region_update", "h3_cell": "872664c1effffff", "snapshot": {} }
{ "type": "ping" }
{ "type": "error", "code": "INVALID_SUBSCRIPTION", "message": "Too many cells" }
```
