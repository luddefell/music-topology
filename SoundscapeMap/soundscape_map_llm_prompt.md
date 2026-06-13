# SoundscapeMap — LLM Execution Prompt
### A Living Musical Landscape: Architecture, Plan & Build Instructions

---

## CONTEXT FOR THE LLM

You are being asked to design and build **SoundscapeMap**, a full-stack web application that turns a geographic map into a living musical landscape. The map reflects the real-time musical character of physical locations, driven by community votes and Spotify listening data.

This document is your complete spec. Read it fully before producing any code or architecture. Where you encounter trade-offs, document your reasoning. Where assumptions are required, state them explicitly and proceed.

---

## GOAL STATEMENT

Build a real-time, community-driven web application where users at a physical location vote for the song or genre that best represents that place right now. The map renders geographic regions color-coded and styled by their dominant music genre, updated continuously as votes are cast and Spotify listening data flows in. The result is a living, crowd-sourced musical portrait of any city, neighborhood, or venue at any moment in time.

**The three pillars of the product are:**
1. **Community input** — users vote for the song/genre representing their location
2. **Spotify listening data** — what people are actually hearing at a location informs the map
3. **Living visualization** — the map updates in near real-time and is beautiful to look at

---

## PHASE-BY-PHASE PLAN

### PHASE 0 — Clarifications and Assumptions

Before building, state and document the following assumptions:

- **Map granularity**: Regions start as H3 hexagonal grid cells (Uber H3, resolution 7 ≈ 1.22 km²) used as the atomic spatial unit for vote ingestion. However, the *rendered* regions on the map are NOT fixed H3 cells — they are dynamically discovered clusters of musically similar users, computed by an ML clustering pipeline (see Phase 3.5). Regions are NOT pre-drawn political boundaries; they emerge organically from the spatial and acoustic distribution of users.
- **Spotify access**: The app uses the Spotify Web API with OAuth 2.0 PKCE for user authentication. It reads the user's currently playing track and recently played tracks. It does NOT stream audio.
- **Voting model**: One vote per user per region per 30-minute window. Votes decay using a half-life model (votes older than 2 hours contribute less weight).
- **Music classification**: Genres are derived from Spotify's Artist genre tags, collapsed into a fixed taxonomy of 12 macro-genres (see Data Model).
- **Anonymous fallback**: Users who do not authenticate with Spotify can still vote using a device fingerprint (no personal data stored). They cannot contribute listening data.
- **Scale target**: Support 10,000 concurrent users, 500 active regions, 50 votes/second at peak.
- **Privacy**: No precise GPS coordinates stored. Only H3 cell IDs. IP geolocation is used as a fallback for location detection.

---

### PHASE 1 — System Architecture

#### 1.1 Architecture Pattern

Use a **microservices-lite** pattern with three primary services:

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                      │
│  React SPA · MapLibre GL · WebSocket client · Spotify OAuth  │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS / WSS
┌──────────────────────▼───────────────────────────────────────┐
│                    API GATEWAY (nginx / Caddy)                │
└─────┬────────────────┬──────────────────┬────────────────────┘
      │                │                  │
┌─────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐
│ Auth Service│  │  Vote Service│  │ Region Service│
│ (Node/TS)  │  │  (Node/TS)  │  │  (Python)     │
└─────┬──────┘  └──────┬──────┘  └───────┬───────┘
      │                │                  │
      └────────────────▼──────────────────┘
                ┌──────┴──────┐
                │  Redis PubSub│  ← Real-time event bus
                └──────┬──────┘
                ┌──────▼──────┐
                │  PostgreSQL  │  ← Persistent store
                │  + TimescaleDB│
                └──────┬──────┘
                       │ reads H3 vote vectors (every 5 min)
                ┌──────▼──────────────────────┐
                │   ML Cluster Pipeline        │
                │   (Python · scikit-learn     │
                │    hdbscan · h3-py)          │
                │                              │
                │  HDBSCAN → GMM → QDA         │
                │  (configurable, with         │
                │   quality-based fallback)    │
                └──────┬──────────────────────┘
                       │ publishes cluster GeoJSON
                       ▼
                  Redis PubSub → WebSocket Hub → Clients
```

#### 1.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| **Auth Service** | Spotify OAuth PKCE flow, JWT issuance, token refresh |
| **Vote Service** | Accept votes, validate rate limits, emit to Redis, write to DB |
| **Region Service** | Aggregate votes into region scores, compute dominant genre, serve GeoJSON |
| **ML Cluster Pipeline** | Periodic HDBSCAN/GMM/QDA job: groups H3 cells into musical regions, publishes cluster GeoJSON |
| **Spotify Poller** | Background worker: poll connected users' currently-playing track every 30s |
| **WebSocket Hub** | Broadcast region updates to subscribed clients via Redis PubSub |
| **Redis** | Vote deduplication, session cache, PubSub event bus |
| **PostgreSQL + TimescaleDB** | Votes table (time-series), regions table, users table |
| **React SPA** | Map rendering, voting UI, Spotify OAuth, WebSocket listener |

#### 1.3 Data Flow (End-to-End)

```
User opens app
  → Browser requests geolocation permission
  → H3 cell computed from lat/lng (client-side, no server round-trip)
  → WebSocket subscribe to that cell's update channel

User authenticates with Spotify (optional)
  → OAuth PKCE flow → Auth Service → JWT stored in memory (not localStorage)
  → Spotify Poller begins polling user's current track every 30s

User votes for a song
  → POST /votes { h3_cell, track_id, genre } + JWT
  → Vote Service validates: rate limit, cell validity, JWT
  → Vote written to PostgreSQL votes table
  → Vote event published to Redis channel: "region:{h3_cell}"
  → Region Service recomputes dominant genre for cell
  → Updated GeoJSON published via WebSocket to all subscribers of that cell

Map updates
  → Client receives WebSocket event
  → Region recolored to new genre color
  → Smooth CSS transition over 800ms
```

---

### PHASE 2 — Data Sources

#### 2.1 Spotify REST API

Endpoints to use:

| Endpoint | Purpose | Auth Required |
|---|---|---|
| `GET /me/player/currently-playing` | What the user is listening to right now | User OAuth |
| `GET /me/player/recently-played` | Last 50 tracks (as fallback) | User OAuth |
| `GET /artists/{id}` | Fetch genre tags for an artist | Client Credentials |
| `GET /audio-features/{id}` | BPM, energy, valence (mood signals) | Client Credentials |
| `GET /search` | Validate a song the user is searching for | Client Credentials |

Rate limits to respect:
- Spotify enforces per-user rate limits. Do not poll more than once every 30 seconds per user.
- For the Spotify Poller, implement a token bucket limiter (max 1 request per user per 30 seconds).
- On HTTP 429, back off exponentially with jitter. Cache the 429 Retry-After header.
- Store fetched artist genres in a local cache (TTL: 24 hours) to avoid redundant API calls.

#### 2.2 Geolocation

Primary: Browser `navigator.geolocation.getCurrentPosition()`  
Fallback: IP geolocation via `https://ipapi.co/json/` (free tier, 1000 req/day) or self-hosted `maxmind/geoip2`  
H3 Cell computation: Use `h3-js` library on the client to convert lat/lng → H3 cell ID at resolution 7

#### 2.3 Manual Vote Input

Users who deny geolocation can type a city name or postal code. Resolve to H3 cell via a geocoding endpoint (use OpenStreetMap Nominatim, self-hostable, no API key required).

---

### PHASE 3 — Data Model

#### 3.1 Genre Taxonomy (12 Macro-Genres)

Map Spotify's artist genre strings to this fixed set:

```json
{
  "genres": [
    { "id": "electronic", "label": "Electronic", "color": "#8B5CF6", "icon": "⚡" },
    { "id": "hiphop",     "label": "Hip-Hop",    "color": "#F59E0B", "icon": "🎤" },
    { "id": "rock",       "label": "Rock",       "color": "#EF4444", "icon": "🎸" },
    { "id": "pop",        "label": "Pop",        "color": "#EC4899", "icon": "✨" },
    { "id": "jazz",       "label": "Jazz",       "color": "#3B82F6", "icon": "🎷" },
    { "id": "classical",  "label": "Classical",  "color": "#6B7280", "icon": "🎼" },
    { "id": "latin",      "label": "Latin",      "color": "#F97316", "icon": "💃" },
    { "id": "country",    "label": "Country",    "color": "#84CC16", "icon": "🤠" },
    { "id": "rnb",        "label": "R&B / Soul", "color": "#A855F7", "icon": "🎵" },
    { "id": "folk",       "label": "Folk / Indie","color": "#78716C", "icon": "🎻" },
    { "id": "metal",      "label": "Metal",      "color": "#1F2937", "icon": "🤘" },
    { "id": "world",      "label": "World",      "color": "#10B981", "icon": "🌍" }
  ]
}
```

Genre mapping is implemented as a keyword-matching function over Spotify genre strings:

```typescript
function classifyGenre(spotifyGenres: string[]): MacroGenre {
  const joined = spotifyGenres.join(' ').toLowerCase();
  if (/hip.hop|rap|trap|drill/.test(joined))   return 'hiphop';
  if (/electr|house|techno|edm|dance/.test(joined)) return 'electronic';
  if (/rock|punk|grunge|indie rock/.test(joined))   return 'rock';
  // ... etc. Last fallback: 'pop'
  return 'pop';
}
```

#### 3.2 Database Schema

```sql
-- PostgreSQL + TimescaleDB

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id   TEXT UNIQUE,               -- null if anonymous
  device_hash  TEXT,                       -- hashed device fingerprint
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE votes (
  id           BIGSERIAL,
  user_id      UUID REFERENCES users(id),
  h3_cell      TEXT NOT NULL,             -- H3 cell ID (e.g. "872830828ffffff")
  track_id     TEXT NOT NULL,             -- Spotify track URI
  genre        TEXT NOT NULL,             -- macro-genre id
  weight       FLOAT DEFAULT 1.0,         -- decays over time
  voted_at     TIMESTAMPTZ DEFAULT NOW(),
  source       TEXT CHECK (source IN ('vote', 'listening'))
);

-- Convert to hypertable for time-series queries
SELECT create_hypertable('votes', 'voted_at');
CREATE INDEX ON votes (h3_cell, voted_at DESC);

CREATE TABLE region_snapshots (
  h3_cell        TEXT NOT NULL,
  dominant_genre TEXT NOT NULL,
  genre_scores   JSONB,                   -- { "hiphop": 0.42, "pop": 0.31, ... }
  vote_count     INT,
  computed_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (h3_cell, computed_at)
);

CREATE TABLE spotify_cache (
  track_id     TEXT PRIMARY KEY,
  artist_id    TEXT,
  genres       TEXT[],
  audio_features JSONB,
  cached_at    TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3.3 Vote Weight Model (Decay Function)

```typescript
// Votes lose weight exponentially. Half-life = 45 minutes.
const HALF_LIFE_MINUTES = 45;

function computeWeight(votedAt: Date): number {
  const ageMinutes = (Date.now() - votedAt.getTime()) / 60000;
  return Math.pow(0.5, ageMinutes / HALF_LIFE_MINUTES);
}

// Aggregate scores for a cell:
function computeRegionScores(votes: Vote[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const vote of votes) {
    const w = computeWeight(vote.voted_at);
    scores[vote.genre] = (scores[vote.genre] ?? 0) + w;
  }
  return scores;
}
```

#### 3.4 API Schema (REST)

```
POST   /api/votes
       Body: { h3_cell: string, track_id: string, genre: string }
       Headers: Authorization: Bearer <JWT>
       Response: { ok: true, region_snapshot: RegionSnapshot }

GET    /api/regions
       Query: ?cells=h3cell1,h3cell2,...  (max 500)
       Response: { features: GeoJSON FeatureCollection }

GET    /api/regions/:h3_cell
       Response: { h3_cell, dominant_genre, genre_scores, vote_count, top_tracks: [] }

GET    /api/search/tracks?q=<query>
       Response: { tracks: [{ id, name, artist, genre, album_art }] }

WebSocket: wss://api.soundscapemap.com/ws
       Client sends: { subscribe: ["872830828ffffff", "872830829ffffff"] }
       Server pushes: { type: "region_update", h3_cell: "...", snapshot: RegionSnapshot }
```

---

### PHASE 3.5 — ML-Driven Region Discovery

Rather than forcing votes into a fixed grid, an ML pipeline periodically re-discovers which H3 cells genuinely belong together as a coherent musical zone. The H3 grid remains the unit of data collection; clustering operates on top of it to draw the *rendered* region boundaries.

#### 3.5.1 Why ML Clustering Instead of Fixed Cells

Fixed H3 grids impose arbitrary boundaries that cut through culturally unified areas (a single music venue's crowd, a festival, a dense neighborhood). ML clustering allows the map to:
- Merge adjacent cells that share the same musical character into a single visible region
- Split a single H3 cell into sub-zones when acoustic diversity is high enough
- Reflect organic cultural geography rather than a hexagonal lattice

#### 3.5.2 Feature Vector Per H3 Cell

Each H3 cell is represented as a vector before clustering. Compute this vector every 5 minutes from votes cast in the past 2 hours (time-weighted):

```python
# Feature vector for one H3 cell (dimension: 12 + 4 + 1 = 17)
features = {
    # Genre distribution (12 macro-genres, sum to 1.0)
    "genre_electronic": 0.42,
    "genre_hiphop":     0.31,
    # ... all 12 genres

    # Spotify audio features (mean of all voted tracks, time-weighted)
    "audio_energy":     0.74,   # 0.0–1.0
    "audio_valence":    0.61,   # happiness proxy
    "audio_danceability": 0.80,
    "audio_tempo_norm": 0.68,   # BPM normalized to [0, 1] over 60–200 BPM range

    # Spatial signal
    "vote_density":     0.55,   # votes per km² normalized over city max
}
```

Cells with fewer than 3 weighted votes in the window are excluded from clustering (marked as "undefined zone" on the map).

#### 3.5.3 Candidate Algorithms

Evaluate the following in order of implementation complexity. The executor should implement and benchmark all three; the production model is selected based on silhouette score and real-world interpretability.

---

**Option A — Gaussian Discriminant Analysis (GDA) with Spatial Prior**

GDA models each genre cluster as a Gaussian distribution over the feature space. The spatial prior penalizes cluster assignments that are geographically discontiguous.

```python
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis, QuadraticDiscriminantAnalysis
import numpy as np

# LDA: shared covariance across genre classes (faster, interpretable)
# QDA: per-class covariance (better when genres have different spreads)
# Use QDA as default; fall back to LDA if n_samples < 50 per class

# Step 1: Fit QDA on labeled training data
# (bootstrap: use genre_distribution argmax as weak label for initial fit)
qda = QuadraticDiscriminantAnalysis(reg_param=0.1)  # reg_param for numerical stability
qda.fit(X_train, y_train)  # y: dominant macro-genre label per cell

# Step 2: Predict posterior probabilities for each cell
posteriors = qda.predict_proba(X_cells)  # shape: (n_cells, 12)

# Step 3: Apply spatial contiguity constraint (post-processing)
# Cells whose predicted class differs from all neighbors are reassigned
# to their neighbor majority class (smoothing pass)
```

Strengths: probabilistic output (shows genre confidence), fast inference, interpretable decision boundaries.
Limitations: assumes genre distributions are Gaussian (not always true for mixed zones); requires labeled data to bootstrap.

---

**Option B — Gaussian Mixture Models (GMM) with Spatial Regularization**

Fully unsupervised. Discovers latent musical zones without relying on the fixed genre taxonomy as ground truth.

```python
from sklearn.mixture import GaussianMixture
from scipy.spatial import cKDTree

# Augment feature vector with geographic coordinates (scaled)
X_spatial = np.hstack([
    X_features,
    coords[:, 0:1] * spatial_weight,  # latitude (scaled by λ)
    coords[:, 1:2] * spatial_weight   # longitude (scaled by λ)
])
# spatial_weight λ ≈ 0.3: tune so geography influences but doesn't dominate

# Fit GMM — number of components k selected by BIC over k ∈ [5, 20]
best_k, best_bic = 5, np.inf
for k in range(5, 21):
    gm = GaussianMixture(n_components=k, covariance_type='full', random_state=42)
    gm.fit(X_spatial)
    bic = gm.bic(X_spatial)
    if bic < best_bic:
        best_k, best_bic = k, bic

final_gm = GaussianMixture(n_components=best_k, covariance_type='full')
final_gm.fit(X_spatial)

# Soft assignments: each cell belongs to each cluster with a probability
responsibilities = final_gm.predict_proba(X_spatial)  # shape: (n_cells, k)
```

Strengths: discovers emergent zones not tied to the fixed 12-genre taxonomy; soft cluster membership enables smooth gradient rendering on the map; handles overlapping cultural zones.
Limitations: k must be estimated; component semantics must be interpreted post-hoc (what does cluster 3 mean?).

---

**Option C — HDBSCAN (Hierarchical Density-Based Clustering) — Recommended Default**

Identifies arbitrarily shaped dense regions of musical similarity, marks sparse/transition cells as noise, and requires no pre-specified k.

```python
import hdbscan
import numpy as np

# Build feature matrix with spatial coordinates embedded
X = np.hstack([genre_vectors, audio_features, coords_normalized])

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=5,       # Minimum H3 cells to form a region
    min_samples=3,            # Density threshold
    metric='euclidean',
    cluster_selection_method='eom',  # Excess of Mass: stable clusters
    prediction_data=True      # Enables soft clustering
)
clusterer.fit(X)

labels = clusterer.labels_           # -1 = noise (transition zone)
probabilities = clusterer.probabilities_  # Confidence per cell
soft_clusters = hdbscan.all_points_membership_vectors(clusterer)
```

**Why HDBSCAN is the recommended default:**
- No need to specify number of regions — they emerge from data density
- Noise label (-1) naturally represents transition zones between musical areas, which are rendered as gradient blends on the map
- Stable across parameter choices; min_cluster_size maps intuitively to "minimum community size"
- Handles the irregular shapes of real cultural geography (a festival, a strip of bars, a university campus) far better than grid-based or k-means approaches

---

#### 3.5.4 Pipeline Architecture

```
Every 5 minutes (cron in Region Service):

1. FETCH: Pull all H3 cells with ≥ 3 weighted votes in last 2h from TimescaleDB
2. BUILD: Compute feature vectors (genre dist + audio features + coords)
3. CLUSTER: Run HDBSCAN (or GMM/QDA per config flag REGION_MODEL=hdbscan|gmm|qda)
4. LABEL: For each cluster, derive a human-readable label:
     - Dominant genre (argmax of mean genre distribution)
     - Vibe descriptors from audio features:
         energy > 0.7 + danceability > 0.7 → "High Energy"
         valence < 0.3 + energy < 0.4     → "Dark / Moody"
         tempo_norm > 0.8                  → "Fast"
5. POLYGONIZE: Convert cluster → H3 cell set → GeoJSON MultiPolygon
     (use h3-py: cells_to_h3shape → shapely geometry → simplify → GeoJSON)
6. DIFF: Compare new cluster boundaries to previous snapshot
     If Jaccard similarity > 0.85: skip broadcast (no meaningful change)
     Else: publish to Redis → WebSocket → clients
7. PERSIST: Write cluster snapshot to region_snapshots table
```

#### 3.5.5 Cluster → GeoJSON Polygon

```python
import h3
from h3 import h3_set_to_multi_polygon
import shapely.geometry as sg
from shapely.ops import unary_union

def cluster_to_geojson(h3_cells: list[str], cluster_id: int, label: dict) -> dict:
    # Get H3 multi-polygon (list of polygon coordinates)
    multi_poly = h3.cells_to_h3shape(h3_cells)

    # Convert to Shapely for simplification and hole removal
    shapely_geom = sg.shape(multi_poly.__geo_interface__)
    simplified = shapely_geom.simplify(tolerance=0.001, preserve_topology=True)

    return {
        "type": "Feature",
        "geometry": sg.mapping(simplified),
        "properties": {
            "cluster_id": cluster_id,
            "dominant_genre": label["genre"],
            "vibe": label["vibe"],
            "genre_color": GENRE_COLORS[label["genre"]],
            "confidence": label["confidence"],   # mean HDBSCAN probability
            "vote_count": label["vote_count"],
            "cell_count": len(h3_cells),
            "is_transition_zone": label["genre"] == "mixed"
        }
    }
```

#### 3.5.6 Transition Zones and Mixed Areas

HDBSCAN noise points (label = -1) and GMM cells with entropy > 1.5 nats across genre distribution are classified as **transition zones**. These are rendered on the map as:
- A desaturated grey-brown fill
- A subtle animated crosshatch pattern (CSS `repeating-linear-gradient`)
- Tooltip: "Mixed vibes — the sound here is still taking shape"

This is a feature, not an error state. Transition zones between a jazz district and an electronic zone are culturally meaningful and should be communicated visually.

#### 3.5.7 Model Evaluation & Retraining

```python
# Evaluate cluster quality after each run (logged to monitoring):
from sklearn.metrics import silhouette_score, davies_bouldin_score

silhouette = silhouette_score(X, labels[labels != -1])    # target: > 0.45
davies_bouldin = davies_bouldin_score(X, labels[labels != -1])  # target: < 1.2
noise_ratio = (labels == -1).sum() / len(labels)           # target: < 0.25

# If silhouette < 0.3 for 3 consecutive runs:
#   → alert to Slack: "Cluster quality degraded — check data density"
#   → fall back to H3 fixed-cell rendering until resolved
```

Retrain schedule: HDBSCAN/GMM are re-fit from scratch every 5 minutes (they are fast enough at city scale; < 2s for 500 cells). No separate offline training pipeline required unless the city scales beyond 5,000 active cells, at which point introduce an incremental fit strategy.

#### 3.5.8 DB Schema Additions

```sql
CREATE TABLE region_clusters (
  id              BIGSERIAL PRIMARY KEY,
  cluster_id      INT NOT NULL,              -- HDBSCAN label
  model_version   TEXT NOT NULL,             -- e.g. "hdbscan-v3"
  h3_cells        TEXT[] NOT NULL,           -- array of H3 cell IDs in this cluster
  dominant_genre  TEXT NOT NULL,
  genre_scores    JSONB,
  audio_features  JSONB,                     -- mean audio features for cluster
  vibe_label      TEXT,                      -- e.g. "High Energy", "Dark / Moody"
  confidence      FLOAT,                     -- mean HDBSCAN membership probability
  geojson         JSONB,                     -- rendered MultiPolygon
  is_transition   BOOLEAN DEFAULT FALSE,
  computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON region_clusters (computed_at DESC);
CREATE INDEX ON region_clusters USING GIN (h3_cells);  -- fast cell lookup

-- Track model quality metrics over time
CREATE TABLE cluster_quality_log (
  computed_at      TIMESTAMPTZ PRIMARY KEY DEFAULT NOW(),
  model            TEXT,
  n_clusters       INT,
  n_noise_cells    INT,
  silhouette_score FLOAT,
  davies_bouldin   FLOAT,
  fit_duration_ms  INT
);
```

#### 3.5.9 Config Flags

```bash
# Add to environment variables:
REGION_MODEL=hdbscan          # hdbscan | gmm | qda | fixed_h3
CLUSTER_MIN_SIZE=5             # HDBSCAN min_cluster_size
CLUSTER_SPATIAL_WEIGHT=0.3     # λ for geographic coordinate scaling
CLUSTER_RECOMPUTE_INTERVAL=300 # seconds between pipeline runs
CLUSTER_FALLBACK_ON_DEGRADATION=true
```

---

### PHASE 4 — Authentication & Security

#### 4.1 Spotify OAuth 2.0 PKCE Flow

```
1. Client generates code_verifier (random 128 bytes, base64url)
2. Client computes code_challenge = SHA256(code_verifier), base64url encoded
3. Client redirects to:
   https://accounts.spotify.com/authorize
     ?client_id=YOUR_CLIENT_ID
     &response_type=code
     &redirect_uri=https://soundscapemap.com/callback
     &code_challenge_method=S256
     &code_challenge=<code_challenge>
     &scope=user-read-playback-state user-read-recently-played
4. Spotify redirects to /callback?code=<auth_code>
5. Client POSTs to Auth Service: { code, code_verifier }
6. Auth Service exchanges with Spotify for { access_token, refresh_token }
7. Auth Service returns a signed JWT (HS256, 1-hour expiry) to client
8. Client stores JWT in memory (NOT localStorage/sessionStorage — XSS risk)
9. Auth Service stores refresh_token encrypted (AES-256) in DB
```

Required Spotify scopes: `user-read-playback-state`, `user-read-recently-played`

#### 4.2 Rate Limiting

Implement at the API Gateway level using a sliding window counter in Redis:

```
Vote endpoint:    5 votes per user per 30-minute window per H3 cell
Search endpoint:  30 requests per minute per IP
Region endpoint:  100 requests per minute per IP (cacheable)
```

#### 4.3 Input Validation

- Validate H3 cell IDs using `h3-js.isValidCell()` on both client and server
- Validate track IDs against Spotify URI format: `spotify:track:[a-zA-Z0-9]{22}`
- Sanitize all text inputs; genres must be from the fixed taxonomy enum
- CORS: allow only `soundscapemap.com` origin
- CSRF: use SameSite=Strict cookies for session tokens

#### 4.4 WebSocket Security

- Validate JWT on WebSocket upgrade handshake
- Anonymous connections (no JWT) may subscribe to regions but cannot push votes
- Disconnect idle WebSocket connections after 5 minutes; client auto-reconnects

---

### PHASE 5 — User Interaction Flow

#### 5.1 First Load

```
1. App loads → check for stored JWT in memory (session only)
2. Request browser geolocation
   a. Granted → compute H3 cell client-side → fetch region data
   b. Denied → show city search input → resolve to H3 cell via geocoding API
3. Map centers on user's location, zooms to neighborhood level
4. Subscribe to WebSocket channel for visible H3 cells
5. Show "Connect Spotify" CTA (optional)
```

#### 5.2 Voting Flow

```
1. User taps a region on the map OR clicks "Vote for this area"
2. If no Spotify: show track search bar (backed by /api/search/tracks)
   If Spotify connected: pre-fill with currently playing track
3. Confirm song + genre assignment (genre is auto-detected, user can override)
4. Submit vote → optimistic UI update (region pulses, vote count increments)
5. Server confirms → finalize OR revert with error toast
6. Show: "Vote recorded. Next vote available in X minutes."
```

#### 5.3 Region Panel (Sidebar)

When a region is tapped, show:
- Dominant genre badge + color
- Genre distribution bar chart (top 3 genres)
- Top 5 songs voted recently
- "X people vibing here" (approximate active voters in last 2 hours)
- "Vote for this area" button

#### 5.4 Listening Mode

If Spotify is connected and user enables "Auto-vote from listening":
- Every 30 seconds: if user is playing a track and is in a known H3 cell → automatically submit a listening-weighted vote (weight: 0.6, source: 'listening')
- Show ambient indicator in the UI: "🎵 Auto-voting while you listen"

---

### PHASE 6 — Map Rendering

#### 6.1 Stack

Use **MapLibre GL JS** (open-source, no API key required) with a free base map from:
- **OpenMapTiles** self-hosted, OR
- **Maptiler Cloud** (free tier: 100k tiles/month)

Do NOT use Google Maps or Mapbox (cost and licensing).

#### 6.2 H3 to GeoJSON

```typescript
import { cellToBoundary, gridDisk } from 'h3-js';

// Convert H3 cell to GeoJSON polygon
function h3CellToFeature(cell: string, snapshot: RegionSnapshot): GeoJSON.Feature {
  const boundary = cellToBoundary(cell, true); // true = GeoJSON order
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [boundary] },
    properties: {
      h3_cell: cell,
      dominant_genre: snapshot.dominant_genre,
      genre_color: GENRE_COLORS[snapshot.dominant_genre],
      vote_count: snapshot.vote_count,
      opacity: Math.min(0.3 + snapshot.vote_count * 0.05, 0.85)
    }
  };
}
```

#### 6.3 MapLibre Layer Definition

```javascript
map.addLayer({
  id: 'soundscape-regions',
  type: 'fill',
  source: 'regions',
  paint: {
    'fill-color': ['get', 'genre_color'],
    'fill-opacity': ['get', 'opacity'],
    'fill-outline-color': 'rgba(255,255,255,0.2)'
  }
});

map.addLayer({
  id: 'soundscape-regions-pulse',
  type: 'fill',
  source: 'regions',
  filter: ['==', 'just_updated', true],
  paint: {
    'fill-color': '#ffffff',
    'fill-opacity': {
      type: 'interval',
      stops: [[0, 0.4], [800, 0]]  // Pulse animation driven by JS
    }
  }
});
```

#### 6.4 Viewport-Aware Loading

Only fetch and render H3 cells within the visible map viewport + a 1-cell buffer ring:

```typescript
function getVisibleCells(map: MapLibreMap, resolution: number = 7): string[] {
  const bounds = map.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  return polygonToCells(bboxToPolygon(bbox), resolution);
}

// On map move: debounce 300ms, recompute cells, update WebSocket subscriptions
map.on('moveend', debounce(() => {
  const newCells = getVisibleCells(map);
  wsClient.updateSubscriptions(newCells);
  fetchMissingRegions(newCells);
}, 300));
```

#### 6.5 Geographic Considerations

- At zoom < 8: aggregate H3 cells to resolution 4 (large metro areas)
- At zoom 8–11: use resolution 7 (neighborhood level, default)
- At zoom > 11: use resolution 9 (block level, requires more votes to activate)
- Empty regions (no votes in 2 hours): render as translucent grey, no genre label
- Min vote threshold to show a genre: 3 weighted votes (to prevent single-user domination)

---

### PHASE 7 — Real-Time Synchronization

#### 7.1 Update Cadence

| Event | Trigger | Latency Target |
|---|---|---|
| New vote submitted | Immediately | < 500ms client to broadcast |
| Listening poll update | Every 30s per connected user | < 2s delay |
| Region score recompute | On any new vote or poll | < 200ms server-side |
| Map visual update | On WebSocket message received | < 100ms render |
| Full region refresh (fallback) | Every 5 minutes for visible cells | Background |

#### 7.2 WebSocket Protocol

```typescript
// Server → Client messages:
type WSMessage =
  | { type: 'region_update'; h3_cell: string; snapshot: RegionSnapshot }
  | { type: 'ping' }
  | { type: 'error'; code: string; message: string };

// Client → Server messages:
type WSCommand =
  | { type: 'subscribe'; cells: string[] }
  | { type: 'unsubscribe'; cells: string[] }
  | { type: 'pong' };
```

#### 7.3 Redis PubSub Channels

```
Channel naming: "region:{h3_cell}"
Example: "region:872830828ffffff"

On vote submission:
  PUBLISH region:872830828ffffff '{"h3_cell":"872830828ffffff","snapshot":{...}}'

WebSocket Hub:
  - Subscribes to all channels for cells where at least one client is connected
  - Fan-out to all clients subscribed to that cell
  - Unsubscribes from Redis channel when last client leaves
```

#### 7.4 Reconnection Strategy

```typescript
class WSClient {
  private reconnectDelay = 1000;
  private maxDelay = 30000;

  onClose() {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay + Math.random() * 1000); // jitter
  }

  onOpen() {
    this.reconnectDelay = 1000; // reset on success
    this.resubscribeAll();
  }
}
```

---

### PHASE 8 — UI/UX Guidelines

#### 8.1 Visual Design Principles

- **Map is primary**: 100% viewport, controls float over it
- **Genre colors are vivid but semi-transparent**: users must read the street map beneath
- **Dark base map style**: use a dark/muted tile style (e.g. Stamen Toner Light inverted) so genre colors pop
- **Typography**: Use a mono or technical sans for data (vote counts, cell IDs); humanist sans for UI labels
- **Animations**: Region color transitions: 800ms ease-in-out. Vote pulse: 400ms flash white then fade. Keep `prefers-reduced-motion` respected.

#### 8.2 Accessibility

- All genre colors must achieve WCAG AA contrast (4.5:1) against map backgrounds
- Provide a colorblind-safe palette toggle (use Okabe-Ito palette as alternative)
- All interactive controls keyboard-navigable; map regions are tappable/clickable
- Screen reader: region panels must have ARIA labels: "Hip-Hop zone, 42 votes, top song: …"
- Vote confirmation uses both color + icon (not color alone)

#### 8.3 Mobile-First

- Touch targets: minimum 44×44px
- Voting UI: full-screen bottom sheet on mobile
- Map gestures: standard pinch/pan; vote is triggered by long-press on region
- Offline state: show last-known region data with a "Reconnecting…" banner

#### 8.4 Empty States & Edge Cases

- No votes in a cell: "Be the first to define the sound of this area"
- Location denied: "Search for your neighborhood to see its sound"
- Spotify not connected: full voting still available, listening auto-vote is greyed out
- Rate limited: "You've voted recently here. Come back in X minutes."

---

### PHASE 9 — Error Handling, Monitoring & Logging

#### 9.1 Error Handling Strategy

```typescript
// API errors: always return structured JSON
{
  "error": {
    "code": "VOTE_RATE_LIMITED",
    "message": "You have already voted in this area recently.",
    "retry_after": 1800   // seconds
  }
}

// Spotify API errors:
// - 401: refresh token, retry once; on second 401, re-auth
// - 429: respect Retry-After header, queue the request
// - 503: circuit breaker (fail open: skip listening vote, don't break UI)
```

#### 9.2 Circuit Breaker for Spotify

```typescript
// If Spotify API fails 5 times in 60 seconds → open circuit
// Open circuit: skip Spotify polling, serve from cache, show "Limited Spotify data" badge
// After 5 minutes: half-open (try one request)
// On success: close circuit
```

#### 9.3 Monitoring Stack

- **Metrics**: Prometheus + Grafana (or Datadog if budget allows)
  - Votes per second (by region)
  - WebSocket connection count
  - Spotify API error rate + latency p50/p95/p99
  - Region compute latency
- **Logging**: Structured JSON logs (pino / winston), shipped to Loki or CloudWatch
  - Log: vote events, auth events, Spotify poll results, errors
  - Never log: GPS coordinates, Spotify access tokens, user PII
- **Alerting**: PagerDuty / Opsgenie alerts on:
  - Error rate > 5% on vote endpoint
  - WebSocket hub disconnected
  - Spotify circuit breaker opened
  - DB write latency > 500ms

#### 9.4 Health Checks

```
GET /health              → { ok: true, uptime: 3600 }
GET /health/db           → { ok: true, latency_ms: 4 }
GET /health/redis        → { ok: true }
GET /health/spotify      → { ok: true, circuit: "closed" }
```

---

### PHASE 10 — Performance & Scalability

#### 10.1 Targets

| Metric | Target |
|---|---|
| Vote API p99 latency | < 200ms |
| Region GeoJSON fetch | < 100ms (cached) |
| WebSocket broadcast | < 500ms from vote to all subscribers |
| Map render (60 FPS) | No jank on region updates |
| Concurrent users | 10,000 |
| Active regions | 500 |
| Peak vote rate | 50 votes/second |

#### 10.2 Caching Strategy

```
Layer 1: CDN (Cloudflare)
  - Static assets: immutable, 1-year cache
  - Base tile layer: 24h cache
  - /api/regions GeoJSON: 10-second cache (stale-while-revalidate)

Layer 2: Redis
  - Region snapshots: TTL 60s (updated on every new vote)
  - Spotify genre cache: TTL 24h
  - Rate limit counters: TTL 30 minutes (sliding window)
  - Session JWTs: TTL 1h

Layer 3: PostgreSQL
  - TimescaleDB chunks auto-compress data older than 2h
  - Materialized view: `region_current_scores` refreshed every 60s
```

#### 10.3 Horizontal Scaling

- Vote Service and Region Service: stateless, scale horizontally behind load balancer
- WebSocket Hub: use Redis PubSub to fan-out across multiple hub instances (sticky sessions not required)
- Database: PostgreSQL with read replicas for region queries; writes only to primary
- At 10× scale: migrate vote ingestion to Kafka → Flink for stream processing

---

### PHASE 11 — Privacy & Compliance

#### 11.1 Data Minimization

- **GPS coordinates**: NEVER stored. Convert to H3 cell ID immediately in the browser, transmit only the cell ID.
- **Spotify user data**: Store only `spotify_id` (opaque to us), `access_token` (in-memory only, never persisted), `refresh_token` (encrypted at rest, AES-256-GCM).
- **Device fingerprints**: Hashed (SHA-256 + salt) before storage. Used only for anonymous rate limiting.
- **Voting data**: Associated with H3 cell + macro-genre. Track ID stored for top-songs feature only; can be disabled.

#### 11.2 Regulatory Compliance

- **GDPR (EU)**: Provide `/api/users/me/data` (data export) and `/api/users/me` DELETE (right to erasure). Display a cookie consent banner. DPA with Spotify as data processor.
- **CCPA (California)**: Honor "Do Not Sell" signal (GPC header). Privacy policy must list third-party data sources.
- **Spotify Developer ToS**: Do not display Spotify data without attribution. Show "Powered by Spotify" logo where track data appears. Do not cache audio previews.
- **Children**: If COPPA applicability is possible, add age gate before Spotify auth.

#### 11.3 User Control

- Settings panel: "Disconnect Spotify", "Delete my votes", "Opt out of listening auto-vote"
- All data older than 30 days is automatically anonymized (user_id → NULL, device_hash → NULL)

---

### PHASE 12 — Deployment & Stack

#### 12.1 Recommended Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Fast build, strong typing |
| Map | MapLibre GL JS | Open-source, no API key |
| Styling | Tailwind CSS + CSS custom properties | Utility-first, theme-able |
| State | Zustand + React Query | Lightweight, server-state aware |
| Backend API | Node.js 20 + Fastify + TypeScript | High throughput, schema validation |
| Region aggregation | Python 3.12 + FastAPI | h3-py native, NumPy for scoring |
| ML clustering | scikit-learn + hdbscan + shapely | QDA/GMM in sklearn; HDBSCAN for density clustering; shapely for polygon ops |
| Database | PostgreSQL 16 + TimescaleDB | Time-series votes, spatial queries |
| Cache / PubSub | Redis 7 | Fast, native PubSub |
| WebSocket | ws (Node.js) behind nginx | Simple, scalable with Redis |
| Hosting | Render.com or Railway (startup) → AWS ECS (scale) | Low ops overhead |
| CDN | Cloudflare (free tier) | DDoS protection + caching |
| CI/CD | GitHub Actions | Free for public repos |
| Secrets | Doppler or AWS Secrets Manager | Centralized secret rotation |
| Monitoring | Grafana Cloud (free tier) + Loki | Unified metrics + logs |

#### 12.2 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml (pseudocode structure)

on: [push to main]

jobs:
  test:
    - lint (eslint, ruff)
    - type-check (tsc --noEmit)
    - unit tests (vitest, pytest)
    - integration tests (Docker Compose test env)

  build:
    - docker build --tag vote-service:$SHA
    - docker build --tag region-service:$SHA
    - docker push to registry

  deploy:
    - Run DB migrations (prisma migrate deploy)
    - Deploy to staging → run smoke tests
    - Manual approval gate → deploy to production
    - Notify Slack on success/failure
```

#### 12.3 Environment Variables

```bash
# Auth
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...         # Server-side only, never in client bundle
JWT_SECRET=...                     # 256-bit random
REFRESH_TOKEN_ENCRYPTION_KEY=...   # AES-256 key

# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# External
MAPTILER_API_KEY=...               # Free tier for base tiles
IPAPI_KEY=...                      # IP geolocation fallback

# Feature flags
ENABLE_AUTO_VOTE=true
MAX_CELLS_PER_SUBSCRIPTION=50

# ML Cluster Pipeline
REGION_MODEL=hdbscan              # hdbscan | gmm | qda | fixed_h3
CLUSTER_MIN_SIZE=5                # minimum H3 cells per cluster
CLUSTER_SPATIAL_WEIGHT=0.3        # geographic coordinate influence (λ)
CLUSTER_RECOMPUTE_INTERVAL=300    # seconds between pipeline runs
CLUSTER_FALLBACK_ON_DEGRADATION=true  # fall back to fixed H3 if quality drops
```

---

### PHASE 13 — Testing Strategy

#### 13.1 Unit Tests

- Vote weight decay function (`computeWeight`)
- Genre classification function (`classifyGenre`)
- H3 cell validation helpers
- Rate limiter logic (token bucket)
- JWT generation and validation
- Feature vector builder (correct normalization, correct handling of sparse cells)
- Cluster quality evaluation (silhouette + Davies-Bouldin calculations)
- Transition zone detection (entropy threshold logic)
- Cluster → GeoJSON polygon conversion (topology preservation, simplification)

Coverage target: 80% on business logic files.

#### 13.2 Integration Tests

```typescript
// Example: Vote submission flow
test('vote is accepted, stored, and triggers WebSocket broadcast', async () => {
  const user = await createTestUser();
  const jwt = issueTestJWT(user);
  
  const wsClient = await connectTestWebSocket();
  await wsClient.subscribe(['872830828ffffff']);
  
  const response = await POST('/api/votes', {
    h3_cell: '872830828ffffff',
    track_id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    genre: 'hiphop'
  }, { headers: { Authorization: `Bearer ${jwt}` } });
  
  expect(response.status).toBe(200);
  const wsMessage = await wsClient.nextMessage(timeout: 2000);
  expect(wsMessage.type).toBe('region_update');
  expect(wsMessage.snapshot.dominant_genre).toBe('hiphop');
});
```

#### 13.3 End-to-End Tests (Playwright)

- Full Spotify OAuth flow (use Spotify test account)
- Vote submission from map interaction
- Region color change visible after vote
- Rate limit enforced (second vote rejected)
- Mobile viewport voting flow

#### 13.4 Load Tests (k6 or Artillery)

```javascript
// k6 load test: 500 concurrent voters
export const options = { vus: 500, duration: '5m' };
export default function () {
  http.post('/api/votes', JSON.stringify({
    h3_cell: randomCell(),
    track_id: randomTrackId(),
    genre: randomGenre()
  }), { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
  sleep(1);
}
```

Target: p99 vote latency < 200ms at 500 VUs, error rate < 0.1%.

---

### PHASE 14 — Success Criteria & Metrics

#### 14.1 Technical Metrics (Must Pass at Launch)

- [ ] Vote → map update latency < 500ms (p99)
- [ ] Zero votes lost under 50 RPS sustained load
- [ ] Spotify API error rate < 1% under normal conditions
- [ ] App loads in < 3s on 4G mobile (Lighthouse performance > 80)
- [ ] WebSocket reconnects within 10 seconds on network interruption

#### 14.2 Product Metrics (Target at 30 Days)

- Active regions (at least 1 vote in 24h): > 50 in first city deployed
- Vote-to-view conversion: > 20% of map viewers cast at least one vote
- Spotify connection rate: > 30% of active voters connect Spotify
- D7 retention: > 25% of users return within a week
- Average session duration: > 3 minutes

#### 14.3 Definition of Done (Per Phase)

| Phase | Done When |
|---|---|
| Auth | Spotify OAuth flow works end-to-end; JWT issued; anonymous fallback works |
| Voting | Vote persisted to DB; rate limit enforced; WebSocket broadcast fires |
| Map | H3 regions render; colors update in < 800ms; mobile pan/zoom works |
| Real-time | 100 concurrent WebSocket clients receive updates within 500ms |
| Spotify polling | Currently-playing track auto-votes every 30s for connected users |
| Monitoring | Grafana dashboard live; first alert fires on simulated error |
| Load | k6 test passes at 500 VUs; p99 < 200ms |

---

## DELIVERABLE ORDER

Build in this sequence. Do not skip phases.

1. **DB schema + migrations** (Phase 3.2 + 3.5.8)
2. **Auth Service** — Spotify OAuth PKCE + JWT (Phase 4.1)
3. **Vote Service** — POST /votes, rate limiter, DB write (Phase 5.2 + 4.2)
4. **Region Service** — H3 score aggregation, GET /regions with fixed-cell fallback (Phase 3.3)
5. **WebSocket Hub** — subscribe/broadcast via Redis (Phase 7)
6. **Spotify Poller** — background worker, circuit breaker (Phase 2.1 + 9.2)
7. **ML Cluster Pipeline** — feature vector builder → HDBSCAN → GeoJSON publisher (Phase 3.5); validate with silhouette score before enabling in production
8. **React SPA** — map rendering, voting UI, WebSocket client, cluster polygon rendering + transition zone shader (Phase 6 + 8)
9. **CI/CD pipeline** (Phase 12.2)
10. **Monitoring** — include cluster quality dashboard (silhouette, noise ratio, fit time) (Phase 9.3)
11. **Load tests** (Phase 13.4)

---

## CLARIFICATIONS REQUESTED FROM EXECUTOR

Before beginning, confirm or override these decisions:

1. **Map tile provider**: Using Maptiler free tier (100k tiles/month). Is this sufficient for initial launch, or should we self-host OpenMapTiles?
2. **Spotify Developer App**: Do you have a Spotify Developer account and `client_id`? If not, start there: https://developer.spotify.com/dashboard
3. **Initial city**: Which city/region should be the launch market? This determines the initial H3 cell seeding.
4. **Hosting budget**: Render.com hobby tier ($7/month) is assumed. If higher budget is available, ECS Fargate is preferred.
5. **Team size**: This plan is scoped for 1–2 developers over 8–12 weeks. Confirm if timeline needs compression.
6. **ML model preference**: The default is HDBSCAN (unsupervised, no labeled data required). If you have a preference for a discriminative approach (QDA requires initial labeled examples bootstrapped from argmax genre; GMM is fully unsupervised but parametric), specify it via `REGION_MODEL`. If unsure, start with `fixed_h3` and enable `hdbscan` once ≥ 200 active cells are reached in a city.
7. **Cluster recompute interval**: 5-minute default is a reasonable balance between freshness and compute cost. For a festival or live event context, consider dropping this to 60 seconds. Confirm the expected deployment context.

---

*End of SoundscapeMap LLM Execution Prompt — v1.1*
*Ready to execute. Begin with Phase 0 clarifications, then proceed to Phase 1.*
