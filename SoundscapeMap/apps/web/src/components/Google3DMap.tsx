import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  Cartesian3,
  Cesium3DTileset,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  GeoJsonDataSource,
  HeightReference,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CORNELL_REGIONS, GENRE_BY_ID, getGenreColor, type CornellRegion } from '@soundscapemap/shared';
import type { RegionSnapshot } from '../state/useAppStore';

interface Props {
  apiKey: string;
  enabled: boolean;
  selectedRegionId?: string;
  snapshots: Record<string, RegionSnapshot>;
  colorblindPalette: boolean;
  onSelectRegion: (regionId: string) => void;
}

interface MarkerPosition {
  regionId: string;
  name: string;
  x: number;
  y: number;
  color: string;
  voteCount: number;
  selected: boolean;
}

const CORNELL_CAMERA = {
  destination: Cartesian3.fromDegrees(-76.4847, 42.4469, 980),
  orientation: {
    heading: CesiumMath.toRadians(28),
    pitch: CesiumMath.toRadians(-48),
    roll: 0
  }
};

const OVERLAY_ALPHA = {
  idle: 0.12,
  active: 0.34,
  haloIdle: 0.48,
  haloActive: 0.76
};

function markerSize(voteCount: number, selected: boolean) {
  return Math.min(selected ? 78 : 54, 26 + Math.sqrt(Math.max(voteCount, 1)) * 10);
}

function regionCollection(snapshots: Record<string, RegionSnapshot>, colorblindPalette: boolean) {
  return {
    type: 'FeatureCollection',
    features: CORNELL_REGIONS.map((region: CornellRegion) => {
      const snapshot = snapshots[region.region_id];
      const color = getGenreColor(snapshot?.dominant_genre ?? 'unknown', colorblindPalette);
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [region.footprint] },
          properties: {
            region_id: region.region_id,
            name: region.name,
            color,
            latitude: region.position.latitude,
            longitude: region.position.longitude,
            marker_height: region.position.height,
            vote_count: snapshot?.vote_count ?? 0
          }
        };
    })
  };
}

export function Google3DMap({ apiKey, enabled, selectedRegionId, snapshots, colorblindPalette, onSelectRegion }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const footprintSourceRef = useRef<GeoJsonDataSource | null>(null);
  const markerSignatureRef = useRef('');
  const [status, setStatus] = useState(enabled && apiKey ? 'Loading Google 3D campus...' : 'Google 3D key missing. Showing demo regions only.');
  const [markerPositions, setMarkerPositions] = useState<MarkerPosition[]>([]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;
    const viewer = new Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      baseLayer: false
    });
    viewer.scene.globe.show = false;
    viewer.camera.setView(CORNELL_CAMERA);
    viewerRef.current = viewer;

    if (enabled && apiKey) {
      Cesium3DTileset.fromUrl(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`, {
        showCreditsOnScreen: true
      })
        .then((tileset) => {
          viewer.scene.primitives.add(tileset);
          setStatus('Google 3D campus loaded');
        })
        .catch(() => setStatus('Google 3D tiles failed. Check the Map Tiles API key/quota.'));
    }

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: import('cesium').Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position);
      const regionId = picked?.id?.properties?.region_id?.getValue?.();
      if (regionId) onSelectRegion(String(regionId));
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [apiKey, enabled, onSelectRegion]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    GeoJsonDataSource.load(regionCollection(snapshots, colorblindPalette), {
      clampToGround: false
    }).then((source) => {
      if (cancelled) return;
      if (footprintSourceRef.current) viewer.dataSources.remove(footprintSourceRef.current, true);
      source.entities.values.forEach((entity) => {
        const regionId = entity.properties?.region_id?.getValue();
        const snapshot = snapshots[regionId];
        const color = Color.fromCssColorString(getGenreColor(snapshot?.dominant_genre ?? 'unknown', colorblindPalette));
        const isSelected = regionId === selectedRegionId;
        if (entity.polygon) {
          entity.polygon.material = new ColorMaterialProperty(color.withAlpha(isSelected ? OVERLAY_ALPHA.active : OVERLAY_ALPHA.idle));
          entity.polygon.outline = new ConstantProperty(true);
          entity.polygon.outlineColor = new ConstantProperty(Color.WHITE.withAlpha(isSelected ? 0.95 : 0.45));
          entity.polygon.heightReference = new ConstantProperty(HeightReference.CLAMP_TO_GROUND);
        }
      });
      CORNELL_REGIONS.forEach((region) => {
        const snapshot = snapshots[region.region_id];
        const color = Color.fromCssColorString(getGenreColor(snapshot?.dominant_genre ?? 'unknown', colorblindPalette));
        const isSelected = region.region_id === selectedRegionId;
        source.entities.add({
          position: Cartesian3.fromDegrees(region.position.longitude, region.position.latitude),
          properties: { region_id: region.region_id },
          point: {
            pixelSize: markerSize(snapshot?.vote_count ?? 0, isSelected),
            color: color.withAlpha(isSelected ? OVERLAY_ALPHA.haloActive : OVERLAY_ALPHA.haloIdle),
            outlineColor: Color.WHITE.withAlpha(isSelected ? 0.98 : 0.72),
            outlineWidth: isSelected ? 3 : 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.NONE
          }
        });
      });
      viewer.dataSources.add(source);
      footprintSourceRef.current = source;
    });
    return () => {
      cancelled = true;
    };
  }, [snapshots, selectedRegionId, colorblindPalette]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const updateMarkers = () => {
      if (viewer.isDestroyed()) return;
      const markers = CORNELL_REGIONS.map((region) => {
        const snapshot = snapshots[region.region_id];
        const position = Cartesian3.fromDegrees(region.position.longitude, region.position.latitude);
        const screen = viewer.scene.cartesianToCanvasCoordinates(position);
        if (!screen) return undefined;
        const pixelRatio = window.devicePixelRatio || 1;
        return {
          regionId: region.region_id,
          name: region.name,
          x: Math.round(screen.x / pixelRatio),
          y: Math.round(screen.y / pixelRatio),
          color: getGenreColor(snapshot?.dominant_genre ?? 'unknown', colorblindPalette),
          voteCount: snapshot?.vote_count ?? 0,
          selected: region.region_id === selectedRegionId
        };
      }).filter((marker): marker is MarkerPosition => Boolean(marker));
      const signature = markers
        .map((marker) => `${marker.regionId}:${marker.x}:${marker.y}:${marker.color}:${marker.voteCount}:${marker.selected}`)
        .join('|');
      if (signature !== markerSignatureRef.current) {
        markerSignatureRef.current = signature;
        setMarkerPositions(markers);
      }
    };

    updateMarkers();
    viewer.scene.postRender.addEventListener(updateMarkers);
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(updateMarkers);
      }
    };
  }, [snapshots, selectedRegionId, colorblindPalette]);

  const selected = CORNELL_REGIONS.find((region) => region.region_id === selectedRegionId);

  return (
    <div className="google-map-shell">
      <div ref={containerRef} className="google-map-canvas" />
      <div className="region-halo-layer">
        {markerPositions.map((marker) => (
          <button
            type="button"
            key={marker.regionId}
            className={marker.selected ? 'region-halo selected' : 'region-halo'}
            style={{
              left: marker.x,
              top: marker.y,
              '--region-color': marker.color,
              '--region-size': `${markerSize(marker.voteCount, marker.selected)}px`
            } as CSSProperties}
            onClick={() => onSelectRegion(marker.regionId)}
            title={`${marker.name}: ${marker.voteCount} song votes`}
          >
            <span>{marker.voteCount || ''}</span>
          </button>
        ))}
      </div>
      <div className="map-status-pill">{status}</div>
      <div className="map-legend">
        <span>Music intensity</span>
        <div><i className="legend-low" /><i className="legend-mid" /><i className="legend-high" /></div>
      </div>
      <button
        type="button"
        className="map-reset"
        onClick={() => {
          viewerRef.current?.camera.flyTo({ ...CORNELL_CAMERA, duration: 1.4 });
        }}
      >
        Reset campus view
      </button>
      {selected && <div className="map-selected-pill">{selected.name}</div>}
    </div>
  );
}
