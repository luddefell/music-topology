import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { LocateFixed, WifiOff } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { cellToFeature, cellsAround, DEFAULT_CELL, DEFAULT_CENTER, emptySnapshot } from './map/h3';
import { SoundscapeSocket } from './map/wsClient';
import { RegionPanel } from './components/RegionPanel';
import { useAppStore } from './state/useAppStore';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws';
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY ?? '';

export function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [mapReady, setMapReady] = useState(false);
  const {
    jwt,
    snapshots,
    selectedCell,
    autoVote,
    spotifyConnected,
    colorblindPalette,
    setJwt,
    selectCell,
    mergeSnapshot,
    setSpotifyConnected,
    setAutoVote,
    setColorblindPalette
  } = useAppStore();

  const selectedSnapshot = snapshots[selectedCell ?? DEFAULT_CELL] ?? emptySnapshot(selectedCell ?? DEFAULT_CELL);

  const visibleCells = useMemo(() => cellsAround(DEFAULT_CENTER[1], DEFAULT_CENTER[0], 2), []);

  useEffect(() => {
    visibleCells.forEach((cell) => mergeSnapshot(emptySnapshot(cell)));
    selectCell(DEFAULT_CELL);
  }, [visibleCells, mergeSnapshot, selectCell]);

  useEffect(() => {
    const socket = new SoundscapeSocket(WS_URL, mergeSnapshot, setWsStatus);
    socket.connect();
    socket.updateSubscriptions(visibleCells);
    return () => socket.close();
  }, [mergeSnapshot, visibleCells]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const fallbackStyle: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#111416' } }]
    };
    const style = MAPTILER_KEY
      ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`
      : fallbackStyle;

    const map = new maplibregl.Map({
      container: mapNode.current,
      style,
      center: DEFAULT_CENTER,
      zoom: 11,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.on('load', () => {
      map.addSource('regions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'soundscape-regions',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': ['get', 'genre_color'],
          'fill-opacity': ['get', 'opacity'],
          'fill-outline-color': 'rgba(255,255,255,0.25)'
        }
      });
      map.on('click', 'soundscape-regions', (event) => {
        const cell = event.features?.[0]?.properties?.h3_cell;
        if (cell) selectCell(String(cell));
      });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [selectCell]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady) return;
    const source = map?.getSource('regions') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: visibleCells.map((cell) => cellToFeature(snapshots[cell] ?? emptySnapshot(cell), colorblindPalette))
    });
  }, [snapshots, visibleCells, colorblindPalette, mapReady]);

  const voteMutation = useMutation({
    mutationFn: async ({ genre, trackId }: { genre: string; trackId: string }) => {
      const response = await fetch(`${API_BASE}/api/votes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
        },
        body: JSON.stringify({ h3_cell: selectedSnapshot.h3_cell, track_id: trackId, genre })
      });
      if (!response.ok) throw new Error('Vote failed');
      return response.json();
    },
    onSuccess: (data) => mergeSnapshot(data.region_snapshot)
  });

  return (
    <main className="app-shell">
      <div ref={mapNode} className="map-canvas" aria-label="Soundscape map" />
      <header className="top-bar">
        <div>
          <h1>SoundscapeMap</h1>
          <span>Chicago</span>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Use my location"
          onClick={() => {
            navigator.geolocation?.getCurrentPosition((position) => {
              const map = mapRef.current;
              map?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 12 });
            });
          }}
        >
          <LocateFixed size={20} aria-hidden="true" />
        </button>
      </header>

      {wsStatus !== 'connected' && (
        <div className="offline-banner" role="status">
          <WifiOff size={18} aria-hidden="true" />
          <span>Reconnecting</span>
        </div>
      )}

      <RegionPanel
        snapshot={selectedSnapshot}
        spotifyConnected={spotifyConnected}
        autoVote={autoVote}
        colorblindPalette={colorblindPalette}
        onVote={(genre, trackId) => voteMutation.mutate({ genre, trackId })}
        onSpotify={async () => {
          const response = await fetch(`${API_BASE}/api/auth/anonymous`, { method: 'POST' });
          const data = await response.json();
          setJwt(data.jwt);
          setSpotifyConnected(true);
        }}
        onAutoVote={setAutoVote}
        onColorblind={setColorblindPalette}
      />
    </main>
  );
}
