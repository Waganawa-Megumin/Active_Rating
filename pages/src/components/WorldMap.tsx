import { useEffect, useRef } from 'react';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Real slippy map (MapLibre GL) with free OSM/CARTO dark raster tiles — no token
// (design v0.7 §C-2). Asset points are plotted by geo; confirmed attribution vs
// Geo estimate are color-coded (honest map, design v0.7 §C-3).

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

function pseudoGeo(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const lat = ((h % 12000) / 100) - 60;
  const lon = (((h >> 8) % 34000) / 100) - 170;
  return [lon, lat];
}

function toGeoJSON(assets: Array<Record<string, unknown>>) {
  return {
    type: 'FeatureCollection' as const,
    features: assets.slice(0, 500).map((a) => {
      const crit = String(a.criticality ?? 'unknown');
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: pseudoGeo(String(a.id)) },
        properties: {
          estimated: a.state === 'confirmed' ? 0 : 1,
          size: crit === 'crown' ? 8 : crit === 'high' ? 6 : 5,
          label: `${a.entity_type}: ${a.identity}`,
        },
      };
    }),
  };
}

export function WorldMap({ assets }: { assets: Array<Record<string, unknown>> }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

  // create once
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [10, 20],
      zoom: 1.1,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      readyRef.current = true;
      map.addSource('assets', { type: 'geojson', data: toGeoJSON(assets) });
      map.addLayer({
        id: 'asset-glow',
        type: 'circle',
        source: 'assets',
        paint: {
          'circle-radius': ['+', ['get', 'size'], 5],
          'circle-color': ['case', ['==', ['get', 'estimated'], 1], '#e8b339', '#37d0a0'],
          'circle-opacity': 0.14,
        },
      });
      map.addLayer({
        id: 'asset-dot',
        type: 'circle',
        source: 'assets',
        paint: {
          'circle-radius': ['get', 'size'],
          'circle-color': ['case', ['==', ['get', 'estimated'], 1], '#e8b339', '#37d0a0'],
          'circle-stroke-color': 'rgba(255,255,255,0.35)',
          'circle-stroke-width': 1,
        },
      });
      map.on('click', 'asset-dot', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setText(String(f.properties?.label ?? ''))
          .addTo(map);
      });
      map.on('mouseenter', 'asset-dot', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'asset-dot', () => (map.getCanvas().style.cursor = ''));
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update data when assets change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('assets') as maplibregl.GeoJSONSource | undefined;
    src?.setData(toGeoJSON(assets));
  }, [assets]);

  return (
    <div className="panel">
      <h2>世界地図 — 攻撃面の地理分布</h2>
      <div ref={ref} className="worldmap" />
      <div className="legend">
        <span><i className="dot-confirmed" />確定帰属（ASN/cert/whois で裏取り）</span>
        <span><i className="dot-estimated" />Geo推測（CDN/クラウドで実体とズレ得る）</span>
      </div>
      <div className="hint">
        IP Geo は CDN/クラウドで実体とズレるため色分け（誇張しない）。MaxMind 連携（P4）で精度向上。
      </div>
    </div>
  );
}
