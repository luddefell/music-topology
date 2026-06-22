import { useEffect, useMemo, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { PickingInfo } from '@deck.gl/core';
import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
import { CORNELL_REGIONS } from '@soundscapemap/shared';
import { cornellTileIds } from '../map/cornellTiles';
import type { RegionSnapshot } from '../state/useAppStore';

interface Props {
  apiKey: string;
  mapId?: string;
  selectedRegionId?: string;
  snapshots: Record<string, RegionSnapshot>;
  colorblindPalette: boolean;
  onSelectRegion: (regionId: string) => void;
}

interface LearnedCell {
  h3: string;
  dominantGenre: string;
  voteCount: number;
  confidence: number;
  selected: boolean;
}

const CORNELL_CENTER = { lat: 42.4457, lng: -76.4795 };
const CORNELL_OVERVIEW_ZOOM = 16;
const CAMPUS_TILE_IDS = cornellTileIds();

const GOOGLE_ANALYTIC_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'all', elementType: 'geometry', stylers: [{ color: '#f4f5f4' }] },
  { featureType: 'all', elementType: 'labels.text.fill', stylers: [{ color: '#8d9696' }] },
  { featureType: 'all', elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
  { featureType: 'all', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: 48 }] },
  { featureType: 'poi', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#f5f6f5' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#a2aaaa' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f7f8f7' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#ecefed' }] },
  { featureType: 'poi.school', elementType: 'geometry', stylers: [{ color: '#eef0ef' }] },
  { featureType: 'poi.school', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d8dddd' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a9494' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6dee0' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d2d8d8' }] }
];

function hexToRgba(hex: string, alpha = 220): [number, number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    alpha
  ];
}

function confidenceFor(snapshot: RegionSnapshot) {
  const topScore = Math.max(...Object.values(snapshot.genre_scores ?? {}), 0);
  const activity = Math.min(1, snapshot.vote_count / 12);
  return Math.max(0.18, Math.min(0.96, topScore * 0.72 + activity * 0.28));
}

function distanceSq(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function selectedTileLabel(regionId?: string) {
  if (!regionId) return undefined;
  const exact = CORNELL_REGIONS.find((region) => region.region_id === regionId);
  if (exact) return exact.name;
  if (!isValidCell(regionId)) return `Tile ${regionId.slice(-6)}`;
  const [latitude, longitude] = cellToLatLng(regionId);
  const nearest = CORNELL_REGIONS
    .map((region) => ({
      region,
      distance: distanceSq([latitude, longitude], [region.position.latitude, region.position.longitude])
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.region;
  return nearest ? `Near ${nearest.name}` : `Tile ${regionId.slice(-6)}`;
}

function learnedCells(snapshots: Record<string, RegionSnapshot>, selectedRegionId?: string): LearnedCell[] {
  return CAMPUS_TILE_IDS.map((h3) => {
    const snapshot = snapshots[h3];
    return {
      h3,
      dominantGenre: snapshot?.dominant_genre ?? 'pop',
      voteCount: snapshot?.vote_count ?? 0,
      confidence: snapshot ? confidenceFor(snapshot) : 0.18,
      selected: h3 === selectedRegionId
    };
  });
}

function h3BoundaryFeatures(cells: LearnedCell[]) {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [cellToBoundary(cell.h3, true)]
      },
      properties: cell
    }))
  };
}

function createLayers(
  snapshots: Record<string, RegionSnapshot>,
  selectedRegionId: string | undefined,
  colorblindPalette: boolean,
  onSelectRegion: (regionId: string) => void
) {
  const cells = learnedCells(snapshots, selectedRegionId);
  return [
    new H3HexagonLayer<LearnedCell>({
      id: 'learned-h3-cells',
      data: cells,
      getHexagon: (cell) => cell.h3,
      getFillColor: (cell) => {
        if (cell.voteCount <= 0) {
          return cell.selected ? [25, 33, 38, 70] : [35, 43, 48, 14];
        }
        if (cell.selected) return hexToRgba(colorblindPalette ? '#0072b2' : '#c02672', 226);
        if (cell.voteCount >= 6 || cell.confidence > 0.72) return hexToRgba(colorblindPalette ? '#0072b2' : '#b83280', 190);
        if (cell.voteCount >= 2 || cell.confidence > 0.44) return hexToRgba(colorblindPalette ? '#e69f00' : '#f45b4f', 162);
        return hexToRgba(colorblindPalette ? '#f0e442' : '#ffbd5a', 132);
      },
      getLineColor: (cell) => {
        if (cell.selected) return [17, 24, 28, 255];
        return cell.voteCount > 0 ? [255, 255, 255, 84] : [40, 48, 52, 16];
      },
      getLineWidth: (cell) => cell.selected ? 3.5 : 0.45,
      lineWidthUnits: 'pixels',
      pickable: true,
      coverage: 0.9,
      onClick: (info: PickingInfo<LearnedCell>) => {
        if (info.object?.h3) onSelectRegion(info.object.h3);
      },
      updateTriggers: {
        getFillColor: [snapshots, selectedRegionId, colorblindPalette],
        getLineColor: [snapshots, selectedRegionId, colorblindPalette]
      }
    }),
    new GeoJsonLayer<Record<string, unknown>>({
      id: 'learned-tile-picker-boundaries',
      data: h3BoundaryFeatures(cells) as never,
      filled: false,
      stroked: true,
      getLineColor: (feature) => {
        const properties = feature.properties as unknown as LearnedCell;
        if (properties.selected) return [47, 51, 51, 255];
        return properties.voteCount > 0 ? [255, 255, 255, 64] : [47, 61, 67, 12];
      },
      getLineWidth: (feature) => ((feature.properties as unknown as LearnedCell).selected ? 5 : 0.7),
      lineWidthUnits: 'pixels',
      pickable: true,
      onClick: (info: PickingInfo) => {
        const h3 = (info.object?.properties as LearnedCell | undefined)?.h3;
        if (h3) onSelectRegion(h3);
      },
      updateTriggers: {
        getLineColor: [selectedRegionId],
        getLineWidth: [selectedRegionId]
      }
    })
  ];
}

export function GoogleDeckMap({ apiKey, mapId, selectedRegionId, snapshots, colorblindPalette, onSelectRegion }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const optionsSetRef = useRef(false);
  const [status, setStatus] = useState(apiKey ? 'Loading analytical Google map...' : 'Google Maps key missing. Add VITE_GOOGLE_MAPS_API_KEY.');

  const layers = useMemo(
    () => createLayers(snapshots, selectedRegionId, colorblindPalette, onSelectRegion),
    [snapshots, selectedRegionId, colorblindPalette, onSelectRegion]
  );

  useEffect(() => {
    if (!apiKey || !containerRef.current || mapRef.current) return;
    let cancelled = false;

    async function initMap() {
      try {
        if (!optionsSetRef.current) {
          setOptions({ key: apiKey, v: 'weekly', mapIds: mapId ? [mapId] : undefined });
          optionsSetRef.current = true;
        }
        const { Map } = await importLibrary('maps');
        if (cancelled || !containerRef.current) return;
        const map = new Map(containerRef.current, {
          center: CORNELL_CENTER,
          zoom: CORNELL_OVERVIEW_ZOOM,
          heading: 0,
          tilt: 0,
          mapId,
          styles: mapId ? undefined : GOOGLE_ANALYTIC_STYLE,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#0a0f12'
        });
        const overlay = new GoogleMapsOverlay({ layers, interleaved: false });
        overlay.setMap(map);
        mapRef.current = map;
        overlayRef.current = overlay;
        setStatus('Learned-zone map loaded');
      } catch {
        setStatus('Google map failed. Check Maps JavaScript API key, billing, and referrer settings.');
      }
    }

    void initMap();
    return () => {
      cancelled = true;
      overlayRef.current?.setMap(null);
      overlayRef.current?.finalize();
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, [apiKey, mapId, layers]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  const selectedLabel = selectedTileLabel(selectedRegionId);

  return (
    <div className="google-map-shell analytical-map-shell">
      <div ref={containerRef} className="google-map-canvas analytical-map-canvas" />
      <div className="map-status-pill">{status}</div>
      <div className="map-legend analytical-legend">
        <span>Learned zones</span>
        <div><i className="legend-low" /><i className="legend-mid" /><i className="legend-high" /></div>
      </div>
      <button
        type="button"
        className="map-reset"
        onClick={() => {
          mapRef.current?.panTo(CORNELL_CENTER);
          mapRef.current?.setZoom(CORNELL_OVERVIEW_ZOOM);
        }}
      >
        Reset campus view
      </button>
      {selectedLabel && <div className="map-selected-pill">{selectedLabel}</div>}
    </div>
  );
}
