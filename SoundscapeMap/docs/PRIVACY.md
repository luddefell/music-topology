# Privacy and Compliance

## Data Minimization

- GPS coordinates are not stored. The browser converts coordinates to H3 cells before sending data.
- Spotify access tokens stay in memory only.
- Spotify refresh tokens are intended to be encrypted with AES-256-GCM before persistence.
- Device fingerprints are salted and hashed for anonymous rate limiting only.
- Voting rows store H3 cell, macro-genre, source, timestamp, and optionally track id for top-song display.

## User Control

The API surface reserves:

- `DELETE /api/users/me` for right to erasure.
- `GET /api/users/me/data` for data export.
- Settings controls for disconnecting Spotify, deleting votes, and opting out of listening auto-vote.

## Spotify ToS

Track data views must display Spotify attribution before production launch. Audio previews are not cached.

## Retention

Data older than 30 days should be anonymized by scheduled job: `user_id = NULL`, `device_hash = NULL`.
