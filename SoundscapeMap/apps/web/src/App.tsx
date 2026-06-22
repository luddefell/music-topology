import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Headphones, LocateFixed, Music2, Radio, RotateCcw, Search, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
import { CORNELL_REGIONS, GENRE_BY_ID, sortedGenreScores, type CornellRegion } from '@soundscapemap/shared';
import { cellToLatLng, gridDisk, isValidCell, latLngToCell } from 'h3-js';
import { GoogleDeckMap } from './components/GoogleDeckMap';
import { SoundscapeSocket } from './map/wsClient';
import { CORNELL_H3_RESOLUTION, cornellTileIds } from './map/cornellTiles';
import { useAppStore, type RegionSnapshot } from './state/useAppStore';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws';
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? import.meta.env.VITE_GOOGLE_3D_TILES_KEY ?? '';
const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID ?? '';

interface TrackResult {
  id: string;
  name: string;
  artist: string;
  genre: string;
  genre_label?: string;
  spotify_genres?: string[];
  album_art?: string | null;
}

interface ListeningStatusResponse {
  status: 'off' | 'listening';
  poll_count?: number;
  vote_count?: number;
  last_status?: 'idle' | 'polling' | 'no_playback' | 'same_track' | 'voted' | 'unauthorized' | 'rate_limited' | 'error';
  last_polled_at?: string;
  last_vote_at?: string;
  last_track_name?: string;
  last_error?: string;
}

function relativeTimeLabel(value?: string) {
  if (!value) return 'not yet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function listeningDetail(data: ListeningStatusResponse) {
  const pollText = `poll ${data.poll_count ?? 0}`;
  if (data.status === 'off') return 'Auto-vote off';
  if (data.last_status === 'voted') {
    return `Voted: ${data.last_track_name ?? 'current track'} (${pollText})`;
  }
  if (data.last_status === 'same_track') {
    return `Polling: same track ${data.last_track_name ?? ''} (${relativeTimeLabel(data.last_polled_at)})`;
  }
  if (data.last_status === 'no_playback') {
    return `Polling: no active Spotify playback (${relativeTimeLabel(data.last_polled_at)})`;
  }
  if (data.last_status === 'rate_limited') {
    return `Polling paused: Spotify rate limited (${pollText})`;
  }
  if (data.last_status === 'unauthorized') {
    return data.last_error ?? 'Reconnect Spotify to use auto-vote';
  }
  if (data.last_status === 'error') {
    return data.last_error ?? 'Spotify polling error';
  }
  return `Polling Spotify (${pollText}, last ${relativeTimeLabel(data.last_polled_at)})`;
}

function distanceSq(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function nearestCornellRegion(regionId: string): CornellRegion | undefined {
  if (!isValidCell(regionId)) return CORNELL_REGIONS.find((region) => region.region_id === regionId);
  const [latitude, longitude] = cellToLatLng(regionId);
  return CORNELL_REGIONS
    .map((region) => ({
      region,
      distance: distanceSq([latitude, longitude], [region.position.latitude, region.position.longitude])
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.region;
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location blocked. Click tiles to simulate moving around Cornell.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'Location unavailable. Demo follow is using the selected tile.';
  if (error.code === error.TIMEOUT) return 'Location timed out. Demo follow is using the selected tile.';
  return `${error.message || 'Location lookup failed.'} Demo follow is using the selected tile.`;
}

function spotifyGenreText(track: { genre_label?: string; spotify_genres?: string[] }) {
  const label = track.genre_label?.trim();
  if (label && label !== 'Spotify genre unavailable') return label;
  return track.spotify_genres?.filter(Boolean).slice(0, 2).join(', ') || 'Spotify genre unavailable';
}

function emptySnapshot(regionId: string): RegionSnapshot {
  const region = CORNELL_REGIONS.find((item) => item.region_id === regionId);
  const isTile = isValidCell(regionId);
  return {
    region_id: regionId,
    region_type: region?.region_type ?? (isTile ? 'h3' : 'building'),
    h3_cell: isTile ? regionId : region?.region_id ?? regionId,
    name: region?.name ?? (isTile ? `Tile ${regionId.slice(-6)}` : undefined),
    subtitle: region?.subtitle ?? (isTile ? 'Learned H3 sound tile' : undefined),
    dominant_genre: 'pop',
    genre_scores: {},
    vote_count: 0,
    unique_user_count: 0,
    top_tracks: [],
    computed_at: new Date().toISOString()
  };
}

export function App() {
  const spotifyCallbackHandled = useRef(false);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackResult | undefined>();
  const [searchStatus, setSearchStatus] = useState('');
  const [listeningStatus, setListeningStatus] = useState<'off' | 'listening' | 'paused' | 'needs_spotify' | 'error'>('off');
  const [listeningStatusText, setListeningStatusText] = useState('');
  const [locationFollow, setLocationFollow] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const {
    jwt,
    snapshots,
    selectedRegionId,
    autoVote,
    spotifyConnected,
    spotifyStatus,
    colorblindPalette,
    setJwt,
    selectRegion,
    mergeSnapshot,
    setSpotifyConnected,
    setSpotifyStatus,
    setAutoVote
  } = useAppStore();

  const tileIds = useMemo(() => cornellTileIds(), []);
  const tileIdSet = useMemo(() => new Set(tileIds), [tileIds]);
  const activeRegionId = selectedRegionId ?? tileIds[0];
  const activeSnapshot = snapshots[activeRegionId] ?? emptySnapshot(activeRegionId);
  const nearbyRegion = useMemo(() => nearestCornellRegion(activeRegionId), [activeRegionId]);
  const activeTargetName = activeSnapshot.name ?? (nearbyRegion ? `Near ${nearbyRegion.name}` : `Tile ${activeRegionId.slice(-6)}`);
  const activeTargetSubtitle = activeSnapshot.subtitle ?? (nearbyRegion ? `${nearbyRegion.subtitle} · Tile ${activeRegionId.slice(-6)}` : 'Learned H3 sound tile');
  const activeTargetType = activeSnapshot.region_type === 'h3' || isValidCell(activeRegionId) ? 'tile' : activeSnapshot.region_type;
  const dominant = GENRE_BY_ID[activeSnapshot.dominant_genre] ?? GENRE_BY_ID.pop;
  const topScores = sortedGenreScores(activeSnapshot.genre_scores).slice(0, 3);
  const uniqueContributorCount = activeSnapshot.unique_user_count ?? 0;

  useEffect(() => {
    const storedJwt = localStorage.getItem('soundscape_jwt');
    if (storedJwt) {
      setJwt(storedJwt);
      setSpotifyConnected(true);
      setSpotifyStatus('Spotify connected');
    }
  }, [setJwt, setSpotifyConnected, setSpotifyStatus]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !window.location.pathname.startsWith('/callback')) return;
    if (spotifyCallbackHandled.current) return;
    spotifyCallbackHandled.current = true;

    const stateKey = state ? `spotify_code_verifier:${state}` : undefined;
    const codeVerifier =
      (stateKey ? localStorage.getItem(stateKey) : null) ??
      (stateKey ? sessionStorage.getItem(stateKey) : null) ??
      localStorage.getItem('spotify_code_verifier') ??
      sessionStorage.getItem('spotify_code_verifier');
    if (!codeVerifier) {
      window.alert('Spotify login could not finish because the code verifier is missing. Start Spotify connection again.');
      window.history.replaceState({}, '', '/');
      return;
    }
    setSpotifyStatus('Finishing Spotify connection...');

    fetch(`${API_BASE}/api/auth/spotify/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? 'Spotify login failed.');
        if (stateKey) {
          localStorage.removeItem(stateKey);
          sessionStorage.removeItem(stateKey);
        }
        localStorage.removeItem('spotify_code_verifier');
        sessionStorage.removeItem('spotify_code_verifier');
        localStorage.setItem('soundscape_jwt', data.jwt);
        setJwt(data.jwt);
        setSpotifyConnected(true);
        setSpotifyStatus('Spotify connected');
        window.history.replaceState({}, '', '/');
      })
      .catch((error: Error) => {
        setSpotifyStatus(error.message);
        window.alert(error.message);
        window.history.replaceState({}, '', '/');
      });
  }, [setJwt, setSpotifyConnected, setSpotifyStatus]);

  useEffect(() => {
    if (!selectedRegionId) selectRegion(tileIds[0]);
    CORNELL_REGIONS.forEach((region) => mergeSnapshot(emptySnapshot(region.region_id)));
    fetch(`${API_BASE}/api/regions/demo/cornell`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        data.regions?.forEach((region: { snapshot?: RegionSnapshot }) => {
          if (region.snapshot) mergeSnapshot(region.snapshot);
        });
      })
      .catch(() => undefined);
  }, [mergeSnapshot, selectRegion, selectedRegionId, tileIds]);

  useEffect(() => {
    const socket = new SoundscapeSocket(WS_URL, mergeSnapshot, setWsStatus);
    socket.connect();
    socket.updateSubscriptions([activeRegionId]);
    return () => socket.close();
  }, [mergeSnapshot, activeRegionId]);

  const tileForLocation = useCallback((latitude: number, longitude: number) => {
    const exact = latLngToCell(latitude, longitude, CORNELL_H3_RESOLUTION);
    if (tileIdSet.has(exact)) return exact;
    const nearby = gridDisk(exact, 25).filter((cell) => tileIdSet.has(cell));
    if (!nearby.length) return undefined;
    return nearby
      .map((cell) => ({ cell, distance: distanceSq([latitude, longitude], cellToLatLng(cell) as [number, number]) }))
      .sort((a, b) => a.distance - b.distance)[0]?.cell;
  }, [tileIdSet]);

  const selectActiveTile = useCallback((regionId: string) => {
    selectRegion(regionId);
    if (locationFollow) setLocationStatus(`Demo follow: Tile ${regionId.slice(-6)}`);
  }, [locationFollow, selectRegion]);

  const refreshListeningStatus = useCallback(async () => {
    if (!jwt) return;
    const response = await fetch(`${API_BASE}/api/listening/status`, {
      headers: { authorization: `Bearer ${jwt}` }
    });
    const data = await response.json() as ListeningStatusResponse;
    if (!response.ok) {
      setListeningStatus('error');
      setListeningStatusText('Could not check Spotify polling');
      return;
    }
    if (data.last_status === 'unauthorized') {
      setListeningStatus('needs_spotify');
      setAutoVote(false);
      setListeningStatusText(listeningDetail(data));
      return;
    }
    setListeningStatus(data.status === 'listening' ? 'listening' : 'off');
    setListeningStatusText(listeningDetail(data));
  }, [jwt, setAutoVote]);

  useEffect(() => {
    if (!autoVote || !jwt) {
      setListeningStatusText('');
      return;
    }
    void refreshListeningStatus();
    const interval = window.setInterval(() => void refreshListeningStatus(), 5000);
    return () => window.clearInterval(interval);
  }, [autoVote, jwt, refreshListeningStatus]);

  async function connectSpotify() {
    setSpotifyStatus('Opening Spotify authorization...');
    const response = await fetch(`${API_BASE}/api/auth/spotify/start`);
    const data = await response.json();
    if (!data.configured) {
      setSpotifyStatus(data.error?.message ?? 'Spotify is not configured.');
      window.alert(data.error?.message ?? 'Spotify is not configured.');
      return;
    }
    const stateKey = `spotify_code_verifier:${data.state}`;
    localStorage.setItem(stateKey, data.code_verifier);
    sessionStorage.setItem(stateKey, data.code_verifier);
    localStorage.setItem('spotify_code_verifier', data.code_verifier);
    sessionStorage.setItem('spotify_code_verifier', data.code_verifier);
    window.location.assign(data.authorize_url);
  }

  async function searchTracks() {
    if (query.trim().length < 2) return;
    setSearchStatus('Searching Spotify...');
    const response = await fetch(`${API_BASE}/api/search/tracks?q=${encodeURIComponent(query)}`, {
      headers: jwt ? { authorization: `Bearer ${jwt}` } : {}
    });
    const data = await response.json();
    if (!response.ok) {
      setSearchStatus(data.error?.message ?? 'Search failed');
      return;
    }
    setTracks(data.tracks ?? []);
    setSearchStatus(data.source === 'seed' ? 'Showing demo tracks until Spotify is connected' : 'Choose a track to add here');
  }

  async function voteTrack() {
    if (!selectedTrack) {
      setSearchStatus('Pick a song before voting');
      return;
    }
    const response = await fetch(`${API_BASE}/api/votes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
      },
      body: JSON.stringify({
        h3_cell: activeRegionId,
        track_id: selectedTrack.id,
        track_name: selectedTrack.name,
        artist: selectedTrack.artist,
        album_art: selectedTrack.album_art,
        genre_label: spotifyGenreText(selectedTrack),
        genre: selectedTrack.genre
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setSearchStatus(data.error?.message ?? 'Vote failed');
      return;
    }
    mergeSnapshot(data.region_snapshot);
    setSearchStatus(`${selectedTrack.name} added to ${activeTargetName}`);
  }

  const syncAutoVoteTarget = useCallback(async (regionId: string, options?: { quiet?: boolean }) => {
    if (!jwt) {
      setListeningStatus('needs_spotify');
      setSpotifyStatus('Connect Spotify before enabling auto-vote');
      setListeningStatusText('Connect Spotify before enabling auto-vote');
      return false;
    }
    if (!options?.quiet) {
      setListeningStatus('paused');
      setListeningStatusText(`Pointing auto-vote at Tile ${regionId.slice(-6)}...`);
    } else {
      setListeningStatusText(`Auto-vote moved to Tile ${regionId.slice(-6)}; checking current song...`);
    }
    const response = await fetch(`${API_BASE}/api/listening/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({ h3_cell: regionId })
    });
    const data = await response.json();
    if (!response.ok) {
      setListeningStatus(data.error?.code === 'SPOTIFY_TOKEN_EXPIRED' ? 'needs_spotify' : 'error');
      setSpotifyStatus(data.error?.message ?? 'Auto-vote failed');
      setListeningStatusText(data.error?.message ?? 'Auto-vote failed');
      setAutoVote(false);
      return false;
    }
    setListeningStatus(data.status === 'listening' ? 'listening' : 'off');
    setListeningStatusText(data.status === 'listening' ? `Auto-vote follows Tile ${regionId.slice(-6)}` : 'Auto-vote off');
    return data.status === 'listening';
  }, [jwt, setAutoVote, setSpotifyStatus]);

  useEffect(() => {
    if (!autoVote || !jwt || listeningStatus === 'needs_spotify' || listeningStatus === 'error') return;
    void syncAutoVoteTarget(activeRegionId, { quiet: true }).then((synced) => {
      if (synced) void refreshListeningStatus();
    });
  }, [activeRegionId, autoVote, jwt, listeningStatus, refreshListeningStatus, syncAutoVoteTarget]);

  useEffect(() => {
    if (!locationFollow) {
      setLocationStatus('');
      return;
    }
    if (!navigator.geolocation) {
      setLocationStatus('Location is not available in this browser');
      return;
    }
    setLocationStatus('Waiting for location...');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextTile = tileForLocation(position.coords.latitude, position.coords.longitude);
        if (!nextTile) {
          setLocationStatus('You are outside Cornell. Click tiles to simulate location for this demo.');
          return;
        }
        selectRegion(nextTile);
        setLocationStatus(`Following Tile ${nextTile.slice(-6)}`);
      },
      (error) => {
        setLocationStatus(geolocationErrorMessage(error));
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [locationFollow, selectRegion, tileForLocation]);

  async function toggleAutoVote(enabled: boolean) {
    if (!jwt) {
      setListeningStatus('needs_spotify');
      setSpotifyStatus('Connect Spotify before enabling auto-vote');
      setListeningStatusText('Connect Spotify before enabling auto-vote');
      return;
    }
    setAutoVote(enabled);
    if (enabled) {
      const started = await syncAutoVoteTarget(activeRegionId);
      if (started) void refreshListeningStatus();
      return;
    }
    setListeningStatus('off');
    setListeningStatusText('Auto-vote off');
    const response = await fetch(`${API_BASE}/api/listening/stop`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`
      }
    });
    const data = await response.json();
    if (!response.ok) {
      setListeningStatus(data.error?.code === 'SPOTIFY_TOKEN_EXPIRED' ? 'needs_spotify' : 'error');
      setSpotifyStatus(data.error?.message ?? 'Auto-vote failed');
      setListeningStatusText(data.error?.message ?? 'Auto-vote failed');
      setAutoVote(false);
      return;
    }
    setListeningStatus(data.status === 'listening' ? 'listening' : 'off');
    setListeningStatusText(data.status === 'listening' ? 'Polling Spotify...' : 'Auto-vote off');
  }

  async function restartSession() {
    if (jwt) {
      await fetch(`${API_BASE}/api/listening/stop`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`
        }
      }).catch(() => undefined);
    }
    localStorage.removeItem('soundscape_jwt');
    localStorage.removeItem('spotify_code_verifier');
    sessionStorage.removeItem('spotify_code_verifier');
    for (const storage of [localStorage, sessionStorage]) {
      Object.keys(storage)
        .filter((key) => key.startsWith('spotify_code_verifier:'))
        .forEach((key) => storage.removeItem(key));
    }
    window.location.assign('/');
  }

  if (!spotifyConnected) {
    return (
      <main className="onboarding-shell">
        <section className="onboarding-copy">
          <div className="brand-mark"><AudioLines size={26} /> SoundscapeMap</div>
          <h1>Let Cornell learn its sound zones.</h1>
          <p>Connect Spotify, search a track, and watch the map group campus into learned music regions.</p>
          <button type="button" className="spotify-cta" onClick={connectSpotify}>
            <Headphones size={20} />
            Connect Spotify
          </button>
          <button type="button" className="ghost-cta" onClick={() => setSpotifyConnected(true)}>
            Explore demo without Spotify
          </button>
          {spotifyStatus && <span className="onboarding-status">{spotifyStatus}</span>}
        </section>
        <section className="onboarding-preview">
          <div className="preview-card">
            <Sparkles size={24} />
            <strong>Cornell learned-zone demo</strong>
            <span>H3 cells cluster into music territories.</span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <GoogleDeckMap
        apiKey={GOOGLE_MAPS_KEY}
        mapId={GOOGLE_MAP_ID}
        selectedRegionId={activeRegionId}
        snapshots={snapshots}
        colorblindPalette={colorblindPalette}
        onSelectRegion={selectActiveTile}
      />

      <header className="dashboard-topbar">
        <div>
          <span>SoundscapeMap</span>
          <strong>Cornell Learned Zones</strong>
        </div>
        <button type="button" className="session-reset" onClick={() => void restartSession()}>
          <RotateCcw size={16} />
          Restart session
        </button>
        {wsStatus !== 'connected' && <div className="offline-banner"><WifiOff size={16} /> Reconnecting</div>}
      </header>

      <aside className="sound-panel">
        <div className="region-kicker">{activeTargetType}</div>
        <h2>{activeTargetName}</h2>
        <p>{activeTargetSubtitle}</p>

        <section className="dominant-card">
          <div className="genre-chip" style={{ borderColor: dominant.color }}>
            <AudioLines size={18} />
            {dominant.label}
          </div>
        </section>

        <section className="metric-grid" aria-label="Tile sound metrics">
          <div>
            <strong>{activeSnapshot.vote_count}</strong>
            <span>recent song adds</span>
          </div>
          <div>
            <strong>{uniqueContributorCount}</strong>
            <span>{uniqueContributorCount === 1 ? 'unique contributor' : 'unique contributors'}</span>
          </div>
        </section>

        <section className="score-bars">
          {topScores.length ? topScores.map(([genre, score]) => {
            const item = GENRE_BY_ID[genre] ?? GENRE_BY_ID.pop;
            return (
              <div className="score-line" key={genre}>
                <span>{item.label}</span>
                <div><i style={{ width: `${Math.max(8, Math.min(100, score * 100))}%`, background: item.color }} /></div>
              </div>
            );
          }) : <p className="empty-copy">No songs yet. Add the first sound to this place.</p>}
        </section>

        <form
          className="song-search"
          onSubmit={(event) => {
            event.preventDefault();
            void searchTracks();
          }}
        >
          <label>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a song, e.g. DID IT AGAIN" />
          </label>
          <button type="submit">Search</button>
        </form>
        {searchStatus && <p className="status-copy">{searchStatus}</p>}

        <div className="track-results">
          {tracks.map((track) => (
            <button
              type="button"
              key={track.id}
              className={selectedTrack?.id === track.id ? 'track-result active' : 'track-result'}
              onClick={() => setSelectedTrack(track)}
            >
              {track.album_art ? <img src={track.album_art} alt="" /> : <Music2 size={22} />}
              <span><strong>{track.name}</strong><small>{track.artist} · {spotifyGenreText(track)}</small></span>
            </button>
          ))}
        </div>

        <button type="button" className="primary-action wide" onClick={voteTrack}>
          <LocateFixed size={18} />
          Add this song near {nearbyRegion?.name ?? activeTargetName}
        </button>

        <div className="panel-actions">
          <label className={`toggle ${autoVote ? 'active' : ''}`}>
            <ShieldCheck size={18} />
            <span>{listeningStatus === 'listening' ? 'Listening' : 'Auto-vote'}</span>
            <input type="checkbox" checked={autoVote} onChange={(event) => void toggleAutoVote(event.target.checked)} />
          </label>
          <label className={`toggle ${locationFollow ? 'active' : ''}`}>
            <LocateFixed size={18} />
            <span>Follow me</span>
            <input type="checkbox" checked={locationFollow} onChange={(event) => setLocationFollow(event.target.checked)} />
          </label>
          <div className="spotify-state"><Radio size={16} /> {listeningStatusText || spotifyStatus}</div>
          {locationStatus && <div className="location-state"><LocateFixed size={16} /> {locationStatus}</div>}
        </div>

        <section className="top-tracks">
          <h3>Recent sound</h3>
          {(activeSnapshot.top_tracks ?? []).slice(0, 4).map((track) => (
            <div className="top-track" key={track.track_id}>
              {track.album_art ? <img src={track.album_art} alt="" /> : <Music2 size={18} />}
              <span>
                <strong>{track.name ?? track.track_id.replace('spotify:track:', '')}</strong>
                {track.artist && <small>{track.artist}{track.genre_label ? ` · ${track.genre_label}` : ''}</small>}
              </span>
              <b>{track.count}</b>
            </div>
          ))}
        </section>
      </aside>
    </main>
  );
}
